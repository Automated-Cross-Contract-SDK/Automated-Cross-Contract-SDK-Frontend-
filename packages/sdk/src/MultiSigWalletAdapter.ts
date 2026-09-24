/**
 * @file MultiSigWalletAdapter.ts
 *
 * Multisig restore support (#240).
 *
 * {@link WalletAdapter.signTransaction} returns a single signed XDR — fine
 * for a 1-of-1 account, but accounts protected by multisig (the norm for
 * DAOs and treasuries) need several signatures on the restore transaction
 * before it can be submitted.
 *
 * {@link MultiSigWalletAdapter} wraps N underlying `WalletAdapter`s. It:
 *
 * - fans the transaction out to every signer (in parallel by default, or
 *   sequentially when `parallel: false`),
 * - merges the collected `DecoratedSignature`s into one envelope,
 * - verifies the accumulated signing weight meets the configured
 *   `threshold` before returning — `signTransaction` throws otherwise, so
 *   an under-signed restore tx is never handed to `sendTransaction`.
 *
 * It implements `WalletAdapter`, so it drops straight into
 * `submitWithRestore({ wallet })`.
 *
 * @example
 * ```ts
 * const treasury = new MultiSigWalletAdapter({
 *   signers: [
 *     { adapter: freighterA, weight: 1 },
 *     { adapter: freighterB, weight: 1 },
 *     { adapter: ledgerC,    weight: 1 },
 *   ],
 *   threshold: 2,            // 2-of-3
 *   networkPassphrase: Networks.PUBLIC,
 * })
 *
 * await sdk.submitWithRestore({ transaction, wallet: treasury })
 * ```
 */

import { FeeBumpTransaction, Keypair, Transaction, TransactionBuilder } from '@stellar/stellar-sdk'
import type { WalletAdapter } from './types.js'
import { asXdrBase64, type XdrBase64 } from './branded-types.js'

/** One participant in a {@link MultiSigWalletAdapter}. */
export interface MultiSigSigner {
  /** The underlying single-signature wallet for this signer. */
  adapter: WalletAdapter
  /**
   * This signer's weight on the account (default `1`). Sum of the weights
   * of the signers who actually sign must reach {@link MultiSigConfig.threshold}.
   */
  weight?: number
}

/** Configuration for {@link MultiSigWalletAdapter}. */
export interface MultiSigConfig {
  /** The signers to collect signatures from (at least one). */
  signers: MultiSigSigner[]
  /** Total signing weight required before the transaction is considered signed. */
  threshold: number
  /** Network passphrase used to parse / re-serialise the transaction. */
  networkPassphrase: string
  /**
   * Prompt signers concurrently (`true`, default) or one after another
   * (`false` — useful when signers share a device or a prompt channel).
   */
  parallel?: boolean
}

/** Outcome of a signature-collection pass. */
export interface SignatureCollectionResult {
  /** The transaction envelope with every collected signature merged in. */
  signedXdr: XdrBase64
  /** Accumulated weight of the signatures that were added. */
  weight: number
  /** Number of distinct signers whose signature was added. */
  signerCount: number
  /** Whether {@link weight} reached the configured threshold. */
  thresholdMet: boolean
}

export class MultiSigWalletAdapter implements WalletAdapter {
  constructor(private readonly config: MultiSigConfig) {
    if (!config.signers || config.signers.length === 0) {
      throw new Error('MultiSigWalletAdapter: at least one signer is required')
    }
    if (!Number.isFinite(config.threshold) || config.threshold <= 0) {
      throw new Error('MultiSigWalletAdapter: threshold must be a positive number')
    }
    if (!config.networkPassphrase) {
      throw new Error('MultiSigWalletAdapter: networkPassphrase is required')
    }
  }

  /** Total weight required for a transaction to be fully signed. */
  get threshold(): number {
    return this.config.threshold
  }

  /** Sum of every configured signer's weight (the maximum attainable). */
  get maxWeight(): number {
    return this.config.signers.reduce((sum, s) => sum + (s.weight ?? 1), 0)
  }

  /** `true` only when every underlying signer reports connected. */
  async isConnected(): Promise<boolean> {
    const flags = await Promise.all(
      this.config.signers.map((s) => s.adapter.isConnected().catch(() => false)),
    )
    return flags.every(Boolean)
  }

  /**
   * Returns the first signer's public key. For a multisig account this is
   * assumed to be the account (source) address; all signers sign the same
   * source account.
   */
  getPublicKey(): ReturnType<WalletAdapter['getPublicKey']> {
    return this.config.signers[0].adapter.getPublicKey()
  }

  /**
   * Collects signatures from every signer and merges them, WITHOUT
   * enforcing the threshold. Use this when you want to inspect progress
   * (e.g. show "2 of 3 collected") before deciding to submit.
   */
  async collectSignatures(
    txXdr: XdrBase64 | string,
    opts?: { networkPassphrase?: string; network?: string },
  ): Promise<SignatureCollectionResult> {
    const networkPassphrase = opts?.networkPassphrase ?? this.config.networkPassphrase
    const signOpts = { ...opts, networkPassphrase }

    const merged = TransactionBuilder.fromXDR(txXdr, networkPassphrase) as
      Transaction | FeeBumpTransaction

    const tasks = this.config.signers.map(
      (s) => () => s.adapter.signTransaction(asXdrBase64(String(txXdr)), signOpts),
    )
    const signedXdrs =
      this.config.parallel === false
        ? await runSequential(tasks)
        : await Promise.all(tasks.map((run) => run()))

    const seen = new Set(merged.signatures.map((sig) => sig.toXDR('base64')))
    let weight = 0
    let signerCount = 0

    signedXdrs.forEach((signedXdr, i) => {
      const signed = TransactionBuilder.fromXDR(signedXdr, networkPassphrase) as
        Transaction | FeeBumpTransaction
      let addedForThisSigner = false
      for (const sig of signed.signatures) {
        const id = sig.toXDR('base64')
        if (seen.has(id)) continue
        seen.add(id)
        merged.signatures.push(sig)
        addedForThisSigner = true
      }
      if (addedForThisSigner) {
        weight += this.config.signers[i].weight ?? 1
        signerCount += 1
      }
    })

    return {
      signedXdr: asXdrBase64(merged.toEnvelope().toXDR('base64')),
      weight,
      signerCount,
      thresholdMet: weight >= this.config.threshold,
    }
  }

  /**
   * Collects and merges signatures, then enforces the threshold.
   *
   * @throws {Error} if the accumulated signing weight is below `threshold`.
   */
  async signTransaction(
    txXdr: XdrBase64 | string,
    opts?: { networkPassphrase?: string; network?: string },
  ): Promise<XdrBase64> {
    const result = await this.collectSignatures(txXdr, opts)
    if (!result.thresholdMet) {
      throw new Error(
        `MultiSigWalletAdapter: collected signing weight ${result.weight} ` +
          `(from ${result.signerCount} signer(s)) is below the required threshold ` +
          `${this.config.threshold}`,
      )
    }
    return result.signedXdr
  }

  /**
   * Re-checks a signed envelope against this adapter's signer set and
   * threshold — call it right before `sendTransaction` as a guard.
   *
   * Signatures are attributed to signers by matching the signature hint
   * (the last 4 bytes of the signer's public key), so weighted thresholds
   * are evaluated correctly.
   */
  async verifyThreshold(
    signedXdr: XdrBase64 | string,
    opts?: { networkPassphrase?: string },
  ): Promise<boolean> {
    const networkPassphrase = opts?.networkPassphrase ?? this.config.networkPassphrase
    const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase) as
      Transaction | FeeBumpTransaction

    const presentHints = new Set(tx.signatures.map((sig) => sig.hint().toString('hex')))
    const signerKeys = await Promise.all(this.config.signers.map((s) => s.adapter.getPublicKey()))

    let weight = 0
    signerKeys.forEach((pk, i) => {
      const hint = Keypair.fromPublicKey(String(pk)).signatureHint().toString('hex')
      if (presentHints.has(hint)) weight += this.config.signers[i].weight ?? 1
    })
    return weight >= this.config.threshold
  }
}

async function runSequential<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  const out: T[] = []
  for (const task of tasks) out.push(await task())
  return out
}
