/**
 * @file branded-types.ts
 *
 * TypeScript branded (nominal) types for the Soroban-Resurrect SDK.
 *
 * ## Why branded types?
 *
 * Many values in the Stellar/Soroban ecosystem are represented as plain
 * strings at runtime, but carry distinct semantics that are invisible to the
 * type system when everything is `string`. For example:
 *
 * - A **transaction hash** is a hex string — passing one where a base64 XDR
 *   envelope is expected (or vice-versa) silently compiles and only fails at
 *   runtime.
 * - A **contract ID** is a hex-encoded 32-byte value — confusing it with a
 *   Stellar public key (a different encoding of a different value) is a common
 *   source of bugs.
 * - A **base64 XDR envelope** and a **raw base64-encoded ledger key** are both
 *   "base64 strings", but they are not interchangeable.
 *
 * Branded types add a phantom type tag (`__brand`) that makes each category a
 * distinct type at the TypeScript level while remaining a plain `string` at
 * runtime — zero cost, no wrapping, no boxing.
 *
 * ## Usage
 *
 * Cast once at the boundary (e.g. when receiving a hash from the RPC layer or
 * encoding an XDR object to base64):
 *
 * ```ts
 * import { asTxHash, asXdrBase64, asContractIdHex } from './branded-types.js'
 *
 * const hash = asTxHash(response.hash)             // TxHash
 * const xdr  = asXdrBase64(ledgerKey.toXDR('base64')) // XdrBase64
 * const id   = asContractIdHex('deadbeef...')       // ContractIdHex
 * ```
 *
 * From that point on TypeScript enforces correct usage everywhere else in the
 * codebase without any runtime overhead.
 */

// ---------------------------------------------------------------------------
// Branded type helper
// ---------------------------------------------------------------------------

/**
 * Creates a branded (nominal) type from a base type `T` and a unique string
 * literal `Brand`. The result is assignable from `T` only via the
 * corresponding `as*` cast function — never accidentally.
 *
 * @example
 * ```ts
 * type Meters = Branded<number, 'Meters'>
 * type Seconds = Branded<number, 'Seconds'>
 * declare const m: Meters
 * declare const s: Seconds
 * const bad: Meters = s // ✗ Type error — cannot assign Seconds to Meters
 * ```
 */
export type Branded<T, Brand extends string> = T & { readonly __brand: Brand }

// ---------------------------------------------------------------------------
// Transaction / block identifiers
// ---------------------------------------------------------------------------

/**
 * A Stellar transaction hash — a lowercase hex string of exactly 64 characters
 * (32 bytes), as returned by `server.sendTransaction()` or stored in RPC
 * responses.
 *
 * @example `"3b6e7f...a4c2"` (64 hex chars)
 */
export type TxHash = Branded<string, 'TxHash'>

/**
 * Casts a plain string to {@link TxHash}.
 * Call this **once** at the point where you receive the hash from the network
 * (e.g. `asTxHash(response.hash)`).
 */
export function asTxHash(value: string): TxHash {
  return value as TxHash
}

// ---------------------------------------------------------------------------
// Contract / address identifiers
// ---------------------------------------------------------------------------

/**
 * A Stellar/Soroban **contract ID** encoded as a lowercase hex string
 * (32 bytes = 64 hex characters).
 *
 * This is the raw byte representation used internally by the XDR layer.
 * Do not confuse with a Stellar public key (G-address / strkey) or a
 * contract address in strkey form (C-address).
 *
 * @example `"deadbeef0102...ff"` (64 hex chars)
 */
export type ContractIdHex = Branded<string, 'ContractIdHex'>

/**
 * Casts a plain string to {@link ContractIdHex}.
 */
export function asContractIdHex(value: string): ContractIdHex {
  return value as ContractIdHex
}

/**
 * A Stellar **public key** (account address) in strkey / G-address format,
 * e.g. `"GABC…"`. Also used for the source account of a transaction.
 */
export type StellarPublicKey = Branded<string, 'StellarPublicKey'>

/**
 * Casts a plain string to {@link StellarPublicKey}.
 */
export function asStellarPublicKey(value: string): StellarPublicKey {
  return value as StellarPublicKey
}

// ---------------------------------------------------------------------------
// Encoding representations
// ---------------------------------------------------------------------------

/**
 * A **base64-encoded XDR** string. Used for ledger keys, transaction
 * envelopes, authorization entries, and other XDR-serialised Stellar objects.
 *
 * Specifically this type covers any value produced by calling
 * `someXdrObject.toXDR('base64')`.
 *
 * @example `"AAAAA..."` (base64 characters)
 */
export type XdrBase64 = Branded<string, 'XdrBase64'>

/**
 * Casts a plain string to {@link XdrBase64}.
 * Use at the point where you call `.toXDR('base64')` or receive the value
 * from a wallet / RPC.
 */
export function asXdrBase64(value: string): XdrBase64 {
  return value as XdrBase64
}

/**
 * A **hex-encoded** binary string. Used when values need to be expressed as
 * a sequence of two-character hex digits, e.g. contract IDs from the XDR
 * layer before being wrapped in {@link ContractIdHex}.
 *
 * Prefer the more specific {@link ContractIdHex} when the hex value
 * specifically represents a contract identifier.
 *
 * @example `"deadbeef"` (lowercase hex characters)
 */
export type HexString = Branded<string, 'HexString'>

/**
 * Casts a plain string to {@link HexString}.
 */
export function asHexString(value: string): HexString {
  return value as HexString
}

// ---------------------------------------------------------------------------
// Network / configuration strings
// ---------------------------------------------------------------------------

/**
 * A Stellar **network passphrase** — a human-readable string that
 * cryptographically identifies a Stellar network (mainnet, testnet, etc.).
 *
 * Examples:
 * - `"Public Global Stellar Network ; September 2015"` (mainnet)
 * - `"Test SDF Network ; September 2015"` (testnet)
 *
 * Branding prevents accidentally swapping the network passphrase with the
 * RPC URL or any other string config field.
 */
export type NetworkPassphrase = Branded<string, 'NetworkPassphrase'>

/**
 * Casts a plain string to {@link NetworkPassphrase}.
 */
export function asNetworkPassphrase(value: string): NetworkPassphrase {
  return value as NetworkPassphrase
}

/**
 * An **RPC endpoint URL** string.
 * Branded separately from {@link NetworkPassphrase} so neither can be passed
 * where the other is expected.
 *
 * @example `"https://soroban-testnet.stellar.org"`
 */
export type RpcUrl = Branded<string, 'RpcUrl'>

/**
 * Casts a plain string to {@link RpcUrl}.
 */
export function asRpcUrl(value: string): RpcUrl {
  return value as RpcUrl
}

// ---------------------------------------------------------------------------
// Fee / ledger primitives
// ---------------------------------------------------------------------------

/**
 * A transaction **fee** expressed in **stroops** (1 XLM = 10,000,000 stroops),
 * represented as a decimal string (as returned by the Stellar SDK).
 *
 * @example `"100"`, `"10000"`
 */
export type FeeStroops = Branded<string, 'FeeStroops'>

/**
 * Casts a plain string to {@link FeeStroops}.
 */
export function asFeeStroops(value: string): FeeStroops {
  return value as FeeStroops
}

/**
 * A Stellar **sequence number**, represented as a decimal string.
 * Sequence numbers are 64-bit integers that must be serialised as strings to
 * avoid JavaScript precision loss.
 *
 * @example `"1234567890"`
 */
export type SequenceNumber = Branded<string, 'SequenceNumber'>

/**
 * Casts a plain string to {@link SequenceNumber}.
 */
export function asSequenceNumber(value: string): SequenceNumber {
  return value as SequenceNumber
}

// ---------------------------------------------------------------------------
// History / session identifiers
// ---------------------------------------------------------------------------

/**
 * A **history entry ID** — the opaque string identifier returned by
 * `TransactionHistory.add()` and used to retrieve / retry a recorded attempt.
 * Format is `"<base36-timestamp>-<random-suffix>"`.
 */
export type HistoryEntryId = Branded<string, 'HistoryEntryId'>

/**
 * Casts a plain string to {@link HistoryEntryId}.
 */
export function asHistoryEntryId(value: string): HistoryEntryId {
  return value as HistoryEntryId
}
