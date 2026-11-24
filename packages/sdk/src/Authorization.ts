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

import { xdr, Transaction, buildAuthorizationEntryPreimage, hash } from '@stellar/stellar-sdk'
import { bytesToHex } from './bytes.js'
import { asXdrBase64, type XdrBase64 } from './branded-types.js'
import type { WalletCapabilities } from './types.js'
import { assertWalletCapability } from './walletCapabilities.js'
import { runWithSignal } from './AbortUtils.js'

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
      /** Cancels the wallet prompt when the adapter supports cancellation. */
      signal?: AbortSignal
    },
  ): Promise<XdrBase64>
  /**
   * Optional feature-detection flags (see {@link WalletCapabilities}). When the
   * wallet sets `capabilities.signAuthEntry === false`, {@link signAuthorizationEntries}
   * throws a clear error instead of calling {@link signAuthEntry}.
   */
  capabilities?: WalletCapabilities
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
  /** Cancels subsequent wallet prompts and stops waiting for the current one. */
  signal?: AbortSignal
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/** Address credentials of any credential arm, or `null` for source-account entries. */
function getAddressCredentials(
  credentials: xdr.SorobanCredentials,
): xdr.SorobanAddressCredentials | null {
  switch (credentials.type) {
    case 'sorobanCredentialsAddress':
      return credentials.address
    case 'sorobanCredentialsAddressV2':
      return credentials.addressV2
    case 'sorobanCredentialsAddressWithDelegates':
      return credentials.addressWithDelegates.addressCredentials
    default:
      return null
  }
}

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
    const isSourceAccount = entry.credentials.type === 'sorobanCredentialsSourceAccount'

    let signerAddress: string | undefined

    if (!isSourceAccount) {
      try {
        const address = getAddressCredentials(entry.credentials)?.address
        if (address?.type === 'scAddressTypeAccount') {
          // accountId is an xdr.PublicKey; encode as base64 for display
          signerAddress = `account:${address.accountId.toXdr('base64')}`
        } else if (address?.type === 'scAddressTypeContract') {
          signerAddress = `contract:${bytesToHex(address.contractId.toBytes())}`
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
  const { entries, wallet, networkPassphrase, signal } = options

  // If any entry actually needs the wallet's signature, make sure the wallet
  // hasn't opted out of CAP-0046 auth-entry signing before we start prompting.
  const needsWalletSignature = entries.some(
    (categorized) => categorized.credentialType === 'address',
  )
  if (needsWalletSignature) {
    assertWalletCapability(wallet, 'signAuthEntry', 'signAuthorizationEntries')
  }

  const signed: xdr.SorobanAuthorizationEntry[] = []

  for (const categorized of entries) {
    if (categorized.credentialType === 'source_account') {
      // Source-account entries are authorized by the tx signature — no action needed
      signed.push(categorized.entry)
      continue
    }

    // Address entries must be signed by the specified address
    const walletOptions = {
      networkPassphrase,
      address: categorized.signerAddress,
      ...(signal ? { signal } : {}),
    }
    const signedXdr = await runWithSignal(
      () => wallet.signAuthEntry(categorized.entryBase64, walletOptions),
      signal,
    )

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
export function attachAuthorizationEntries(options: AttachAuthorizationOptions): Transaction {
  const { transaction, authEntries } = options

  const ops = transaction.operations
  const invokeIdx = ops.findIndex((op) => op.type === 'invokeHostFunction')

  if (invokeIdx === -1) {
    throw new Error('attachAuthorizationEntries: transaction has no InvokeHostFunction operation')
  }

  return withAuthEntries(transaction, invokeIdx, authEntries)
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
  const credentials = getAddressCredentials(entry.credentials)
  if (!credentials) {
    throw new Error('hashAuthorizationEntry: entry has no address credentials to sign')
  }
  const preimage = buildAuthorizationEntryPreimage(
    entry,
    credentials.signatureExpirationLedger,
    networkPassphrase,
  )

  return hash(preimage.toXdr())
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
  return authEntries.some((entry) => entry.credentials.type !== 'sorobanCredentialsSourceAccount')
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
  return authEntries.filter((entry) => entry.credentials.type !== 'sorobanCredentialsSourceAccount')
}

// ---------------------------------------------------------------------------
// High-level integration helper (used by the submitWithRestore executor)
// ---------------------------------------------------------------------------

/**
 * Narrowing type guard: does this wallet implement CAP-0046 per-entry
 * authorization signing (`signAuthEntry`)?
 */
export function supportsAuthEntrySigning(wallet: unknown): wallet is AuthorizationWalletAdapter {
  return (
    wallet != null && typeof (wallet as { signAuthEntry?: unknown }).signAuthEntry === 'function'
  )
}

/** Minimal shape of the simulation response fields this helper reads. */
interface SimulationWithAuth {
  result?: { auth?: xdr.SorobanAuthorizationEntry[] } | null
}

/**
 * Extracts the authorization entries produced by a Soroban transaction
 * simulation (`SimulateTransactionResponse.result.auth`).
 */
export function extractSimulationAuthEntries(
  simulation: SimulationWithAuth,
): xdr.SorobanAuthorizationEntry[] {
  return simulation?.result?.auth ?? []
}

/** Result of {@link ensureAddressAuthorization}. */
export interface EnsureAddressAuthResult {
  /**
   * The transaction to sign and submit. When address-auth entries were signed
   * and attached, this is a freshly rebuilt `Transaction` carrying them; it is
   * otherwise the input transaction unchanged.
   */
  transaction: Transaction
  /** `true` when address-auth entries were signed and attached. */
  signed: boolean
  /** Number of address-credential entries that were signed. */
  signedEntryCount: number
}

/** Options for {@link ensureAddressAuthorization}. */
export interface EnsureAddressAuthorizationOptions {
  /** The transaction whose `InvokeHostFunction` op carries the auth entries. */
  transaction: Transaction
  /** The simulation response for `transaction` (source of the auth entries). */
  simulation: SimulationWithAuth
  /**
   * The signing wallet. When it implements `signAuthEntry`
   * ({@link AuthorizationWalletAdapter}), address-auth entries are signed and
   * attached. When it does not and address-auth is required, this throws.
   */
  wallet: unknown
  /** Network passphrase, required for computing auth-entry hashes. */
  networkPassphrase: string
  /** Cancels subsequent wallet prompts and stops waiting for the current one. */
  signal?: AbortSignal
}

/**
 * Ensures a Soroban transaction carries valid CAP-0046 address-based
 * authorization before it is signed and submitted.
 *
 * - If the simulation produced no entries, or only `source_account` entries,
 *   the transaction is returned unchanged (`signed: false`).
 * - If it produced `address`-credential entries and `wallet` implements
 *   `signAuthEntry`, those entries are signed and attached, and a rebuilt
 *   transaction is returned (`signed: true`).
 * - If it produced `address`-credential entries and `wallet` does **not**
 *   implement `signAuthEntry`, a descriptive `Error` is thrown so the caller
 *   can surface an actionable message instead of silently submitting a
 *   transaction that will fail on-chain.
 *
 * @throws {Error} When address auth is required but the wallet cannot sign it,
 *   or when the transaction has no `InvokeHostFunction` operation to attach to.
 */
export async function ensureAddressAuthorization(
  options: EnsureAddressAuthorizationOptions,
): Promise<EnsureAddressAuthResult> {
  const { transaction, simulation, wallet, networkPassphrase, signal } = options

  const authEntries = extractSimulationAuthEntries(simulation)
  if (authEntries.length === 0 || !requiresAddressAuthorization(authEntries)) {
    return { transaction, signed: false, signedEntryCount: 0 }
  }

  if (!supportsAuthEntrySigning(wallet)) {
    const addressCount = getAddressAuthEntries(authEntries).length
    throw new Error(
      `This transaction requires ${addressCount} address-based authorization ` +
        `signature(s) (CAP-0046 fine-grained auth), but the provided wallet does ` +
        `not implement signAuthEntry(). Use a wallet adapter that implements ` +
        `AuthorizationWalletAdapter, or pre-sign the entries with ` +
        `signAuthorizationEntries() and attach them via attachAuthorizationEntries().`,
    )
  }

  const categorized = categorizeAuthEntries(authEntries)
  const signedEntries = await signAuthorizationEntries({
    entries: categorized,
    wallet,
    networkPassphrase,
    signal,
  })

  const rebuilt = attachSignedAuthEntries(transaction, signedEntries)
  const signedEntryCount = categorized.filter((c) => c.credentialType === 'address').length

  return { transaction: rebuilt, signed: true, signedEntryCount }
}

/** Attaches signed auth entries to the first `InvokeHostFunction` operation. */
function attachSignedAuthEntries(
  transaction: Transaction,
  authEntries: xdr.SorobanAuthorizationEntry[],
): Transaction {
  const invokeIdx = transaction.operations.findIndex((op) => op.type === 'invokeHostFunction')
  if (invokeIdx === -1) {
    throw new Error(
      'ensureAddressAuthorization: transaction has no InvokeHostFunction operation to attach auth entries to',
    )
  }
  return withAuthEntries(transaction, invokeIdx, authEntries)
}

/**
 * Returns an unsigned copy of `transaction` whose operation at `invokeIdx`
 * carries `authEntries`. XDR values are immutable, so the envelope is rebuilt;
 * every other field (fee, sequence, preconditions, Soroban data) is kept.
 */
function withAuthEntries(
  transaction: Transaction,
  invokeIdx: number,
  authEntries: xdr.SorobanAuthorizationEntry[],
): Transaction {
  const envelope = transaction.toEnvelope()
  if (envelope.type !== 'envelopeTypeTx') {
    throw new Error(`Unsupported transaction envelope type: ${envelope.type}`)
  }
  const { tx } = envelope.v1
  const operations = tx.operations.map((operation, index) => {
    if (index !== invokeIdx || operation.body.type !== 'invokeHostFunction') return operation
    const { hostFunction } = operation.body.invokeHostFunctionOp
    return new xdr.Operation({
      sourceAccount: operation.sourceAccount,
      body: xdr.OperationBody.invokeHostFunction(
        new xdr.InvokeHostFunctionOp({ hostFunction, auth: authEntries }),
      ),
    })
  })

  return new Transaction(
    xdr.TransactionEnvelope.envelopeTypeTx(
      new xdr.TransactionV1Envelope({
        tx: new xdr.Transaction({
          sourceAccount: tx.sourceAccount,
          fee: tx.fee,
          seqNum: tx.seqNum,
          cond: tx.cond,
          memo: tx.memo,
          operations,
          ext: tx.ext,
        }),
        // Changing the operations invalidates any existing signature.
        signatures: [],
      }),
    ),
    transaction.networkPassphrase,
  )
}
