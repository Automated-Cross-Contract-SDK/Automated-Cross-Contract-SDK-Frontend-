/**
 * CAP-0046 Fine-Grained Authorization Support
 *
 * CAP-0046 (https://github.com/stellar/stellar-protocol/blob/master/core/cap-0046.md)
 * introduces fine-grained per-invocation authorization for Soroban smart contracts.
 * Each invocation that requires elevated privileges carries a
 * `SorobanAuthorizationEntry` in the transaction's auth list. These entries
 * must be signed either by the invoking source account (invoker auth) or by a
 * specific address (address auth), depending on the contract's requirements.
 *
 * This module provides utilities to:
 * - Inspect authorization entries returned by transaction simulation
 * - Categorize entries by credential type (source-account vs address)
 * - Attach pre-signed or custom-signed authorization entries to a transaction
 * - Provide an interface for wallets that support signing individual auth entries
 */

import { xdr, Transaction, hash } from '@stellar/stellar-sdk'
import { asXdrBase64, type XdrBase64 } from './branded-types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Categorized authorization entry from a simulation response.
 *
 * Entries with `credentialType === 'source_account'` are automatically
 * authorized by the transaction's source account and do not require an
 * additional signature.
 *
 * Entries with `credentialType === 'address'` require a signature from the
 * address specified in the `SorobanAddressCredentials`, typically obtained
 * by calling the wallet's `signAuthEntry` method.
 */
export interface CategorizedAuthEntry {
  /** The raw XDR authorization entry. */
  entry: xdr.SorobanAuthorizationEntry
  /** Base64-encoded XDR of the entry, useful as a stable identifier. */
  entryBase64: XdrBase64
  /** Credential type — determines how the entry must be signed. */
  credentialType: 'source_account' | 'address'
  /**
   * For 'address' entries: a string identifier for the authorizing account or
   * contract. Undefined for 'source_account' entries.
   */
  signerAddress?: string
}

/**
 * Extension of the standard wallet adapter that supports signing individual
 * Soroban authorization entries (CAP-0046 fine-grained authorization).
 *
 * Wallets that do not implement `signAuthEntry` can still use the SDK for
 * invoker-based authorization; only cross-contract calls requiring address
 * credentials need this method.
 */
export interface AuthorizationWalletAdapter {
  /**
   * Signs a single Soroban authorization entry and returns the signed entry.
   *
   * The wallet implementation should:
   * 1. Decode the entry from XDR.
   * 2. Hash the entry preimage using the network passphrase.
   * 3. Sign the hash with the private key of the authorizing address.
   * 4. Attach the signature to the entry's credentials.
   * 5. Return the re-encoded XDR.
   *
   * @param authEntryXdr - Base64-encoded XDR of the `SorobanAuthorizationEntry`.
   * @param opts - Additional context for signing.
   * @returns Base64-encoded XDR of the signed `SorobanAuthorizationEntry`.
   */
  signAuthEntry(
    authEntryXdr: XdrBase64,
    opts?: {
      /** Network passphrase required for computing the auth entry hash. */
      networkPassphrase?: string
      /** The address that should sign the entry. */
      address?: string
    },
  ): Promise<XdrBase64>
}

/**
 * Options for attaching fine-grained authorization to a transaction.
 */
export interface AttachAuthorizationOptions {
  /**
   * The transaction to attach authorization entries to. The transaction
   * must contain at least one `InvokeHostFunction` operation.
   */
  transaction: Transaction
  /**
   * Pre-built or pre-signed authorization entries to attach. These replace
   * any existing auth entries on the matching `InvokeHostFunction` operation.
   *
   * Typically obtained from `signAuthorizationEntries`.
   */
  authEntries: xdr.SorobanAuthorizationEntry[]
}

/**
 * Options for signing authorization entries that require address credentials.
 */
export interface SignAuthorizationEntriesOptions {
  /**
   * The categorized auth entries to sign. Only entries with
   * `credentialType === 'address'` will be passed to the wallet; entries
   * with `credentialType === 'source_account'` are left unchanged.
   */
  entries: CategorizedAuthEntry[]
  /**
   * Wallet that supports signing authorization entries.
   */
  wallet: AuthorizationWalletAdapter
  /**
   * Network passphrase for computing authorization entry hashes.
   */
  networkPassphrase: string
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Categorizes a list of `SorobanAuthorizationEntry` items from a simulation
 * response into source-account entries (no extra signing needed) and address
 * entries (require wallet `signAuthEntry`).
 *
 * @param authEntries - The raw auth entries from `SimulateHostFunctionResult.auth`.
 */
export function categorizeAuthEntries(
  authEntries: xdr.SorobanAuthorizationEntry[],
): CategorizedAuthEntry[] {
  return authEntries.map((entry) => {
    const credentials = entry.credentials()
    const credentialTypeName = credentials.switch().name

    const isSourceAccount = credentialTypeName === 'sorobanCredentialsSourceAccount'

    let signerAddress: string | undefined

    if (!isSourceAccount) {
      try {
        const addressCredentials = credentials.address()
        if (addressCredentials) {
          const address = addressCredentials.address()
          const addrType = address.switch().name
          if (addrType === 'scAddressTypeAccount') {
            // accountId is an xdr.PublicKey; encode as base64 for display
            signerAddress = `account:${address.accountId().toXDR('base64')}`
          } else {
            signerAddress = `contract:${address.contractId().toString('hex')}`
          }
        }
      } catch {
        // Could not extract signer address — leave undefined
      }
    }

    return {
      entry,
      entryBase64: asXdrBase64(entry.toXDR('base64')),
      credentialType: isSourceAccount ? 'source_account' : 'address',
      signerAddress,
    }
  })
}

/**
 * Signs authorization entries that carry address credentials by calling the
 * wallet's `signAuthEntry` method for each one.
 *
 * Entries with `source_account` credentials are passed through unchanged —
 * they are authorized implicitly by the transaction's source account signature.
 *
 * @returns Array of (possibly-signed) raw `SorobanAuthorizationEntry` XDR objects,
 *   in the same order as the input `entries` array.
 */
export async function signAuthorizationEntries(
  options: SignAuthorizationEntriesOptions,
): Promise<xdr.SorobanAuthorizationEntry[]> {
  const { entries, wallet, networkPassphrase } = options

  const signed: xdr.SorobanAuthorizationEntry[] = []

  for (const categorized of entries) {
    if (categorized.credentialType === 'source_account') {
      // Source-account entries are authorized by the tx signature — no action needed
      signed.push(categorized.entry)
      continue
    }

    // Address entries must be signed by the specified address
    const signedXdr = await wallet.signAuthEntry(categorized.entryBase64, {
      networkPassphrase,
      address: categorized.signerAddress,
    })

    signed.push(xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, 'base64'))
  }

  return signed
}

/**
 * Attaches a set of authorization entries to the first `InvokeHostFunction`
 * operation in a transaction, replacing any existing entries.
 *
 * Returns the modified transaction. The original transaction's XDR envelope
 * is mutated in-place (matching the behavior of `assembleTransaction`).
 *
 * @throws If the transaction contains no `InvokeHostFunction` operation.
 */
export function attachAuthorizationEntries(
  options: AttachAuthorizationOptions,
): Transaction {
  const { transaction, authEntries } = options

  const ops = transaction.operations
  const invokeIdx = ops.findIndex((op) => op.type === 'invokeHostFunction')

  if (invokeIdx === -1) {
    throw new Error(
      'attachAuthorizationEntries: transaction has no InvokeHostFunction operation',
    )
  }

  // Access the underlying XDR envelope to mutate the auth list
  const envelope = transaction.toEnvelope()
  const envelopeType = envelope.switch()

  let rawOps: xdr.Operation[]

  if (envelopeType.name === 'envelopeTypeTxV0') {
    rawOps = envelope.v0().tx().operations()
  } else {
    // Covers envelopeTypeTx (V1) and fee-bump inner (which wraps V1)
    rawOps = envelope.v1().tx().operations()
  }

  const rawOp = rawOps[invokeIdx]
  const body = rawOp.body()

  // body.value() returns the underlying InvokeHostFunctionOp when the
  // discriminant is invokeHostFunction — cast via unknown to satisfy TypeScript
  const invokeBody = body.value() as unknown as xdr.InvokeHostFunctionOp
  invokeBody.auth(authEntries)

  return transaction
}

/**
 * Computes the hash of a `SorobanAuthorizationEntry` preimage that wallets
 * must sign for address-based authorization. This is the value that the wallet
 * signs when implementing `signAuthEntry`.
 *
 * The hash is: SHA-256(ENVELOPE_TYPE_SOROBAN_AUTHORIZATION || preimage XDR)
 * where the preimage includes the network id hash, nonce, expiration ledger,
 * and root invocation.
 *
 * @param entry - The authorization entry to hash.
 * @param networkPassphrase - The network passphrase (used as the network id).
 * @returns The 32-byte hash Buffer that must be signed.
 */
export function hashAuthorizationEntry(
  entry: xdr.SorobanAuthorizationEntry,
  networkPassphrase: string,
): Uint8Array {
  // Encode the passphrase to bytes without relying on Node.js Buffer
  const passphraseBytes = new TextEncoder().encode(networkPassphrase)
  // hash() from stellar-base/stellar-sdk accepts Buffer-like Uint8Array
  const networkIdHash = hash(passphraseBytes as unknown as Parameters<typeof hash>[0])
  const addressCreds = entry.credentials().address()

  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: networkIdHash,
      nonce: addressCreds.nonce(),
      signatureExpirationLedger: addressCreds.signatureExpirationLedger(),
      invocation: entry.rootInvocation(),
    }),
  )

  return hash(preimage.toXDR())
}

/**
 * Checks whether a list of simulation auth entries contains any entries that
 * require address-based (non-invoker) authorization.
 *
 * Use this to decide whether to present the user with a secondary signing
 * prompt for fine-grained authorization.
 *
 * @param authEntries - Auth entries from `SimulateHostFunctionResult.auth`.
 * @returns `true` if any entry requires address credentials.
 */
export function requiresAddressAuthorization(
  authEntries: xdr.SorobanAuthorizationEntry[],
): boolean {
  return authEntries.some(
    (entry) =>
      entry.credentials().switch().name !== 'sorobanCredentialsSourceAccount',
  )
}

/**
 * Returns a filtered list of auth entries that require address-based signing.
 * Entries with source-account credentials are excluded.
 *
 * @param authEntries - Auth entries from `SimulateHostFunctionResult.auth`.
 */
export function getAddressAuthEntries(
  authEntries: xdr.SorobanAuthorizationEntry[],
): xdr.SorobanAuthorizationEntry[] {
  return authEntries.filter(
    (entry) =>
      entry.credentials().switch().name !== 'sorobanCredentialsSourceAccount',
  )
}
