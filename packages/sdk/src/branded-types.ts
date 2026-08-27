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
 *
 * ## Runtime validation
 *
 * Each branded type ships a companion `is*` type-guard that validates format
 * at runtime. Use these at **trust boundaries** (e.g. user input, external API
 * responses) where the value's format cannot be guaranteed statically:
 *
 * ```ts
 * import { isTxHash, isContractIdHex } from './branded-types.js'
 *
 * if (!isTxHash(rawString)) throw new Error('Invalid transaction hash')
 * if (!isContractIdHex(contractId)) throw new Error('Invalid contract ID')
 * ```
 *
 * The `as*` cast helpers (e.g. `asTxHash`) remain **unchecked** for use inside
 * the SDK at boundaries that are already type-safe (e.g. right after calling
 * `.toXDR('base64')`). Prefer `is*` guards for external input.
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

/**
 * Runtime type-guard for {@link TxHash}.
 *
 * A valid transaction hash is a lowercase hex string of exactly 64 characters
 * (32 bytes). Uppercase hex characters are accepted and normalised to lowercase
 * by the Stellar SDK, but this guard enforces lowercase-only to match the
 * format returned by `server.sendTransaction()`.
 *
 * @param value - The value to test.
 * @returns `true` if `value` is a valid 64-character lowercase hex string.
 *
 * @example
 * ```ts
 * if (!isTxHash(raw)) throw new Error(`Invalid transaction hash: ${raw}`)
 * const hash = raw as TxHash
 * ```
 */
export function isTxHash(value: unknown): value is TxHash {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
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
 * Runtime type-guard for {@link ContractIdHex}.
 *
 * A valid contract ID hex is exactly 64 lowercase hex characters (32 bytes).
 * This mirrors the XDR representation used by the Stellar network for contract
 * identifiers.
 *
 * @param value - The value to test.
 * @returns `true` if `value` is a valid 64-character lowercase hex string.
 *
 * @example
 * ```ts
 * if (!isContractIdHex(id)) throw new Error(`Not a contract ID: ${id}`)
 * ```
 */
export function isContractIdHex(value: unknown): value is ContractIdHex {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
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

/**
 * Runtime type-guard for {@link StellarPublicKey}.
 *
 * A valid Stellar public key (G-address) starts with `"G"` and is 56
 * characters long — the standard strkey-encoded ED25519 public key format
 * used across the Stellar network.
 *
 * @param value - The value to test.
 * @returns `true` if `value` looks like a Stellar G-address.
 *
 * @example
 * ```ts
 * if (!isStellarPublicKey(address)) throw new Error('Not a Stellar public key')
 * ```
 */
export function isStellarPublicKey(value: unknown): value is StellarPublicKey {
  return typeof value === 'string' && /^G[A-Z2-7]{55}$/.test(value)
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
 * Runtime type-guard for {@link XdrBase64}.
 *
 * Validates that `value` is a non-empty string containing only standard
 * base64 characters (`A-Z`, `a-z`, `0-9`, `+`, `/`) with optional `=`
 * padding, and that its length is a valid base64 length (multiple of 4, or
 * with correct padding). This matches the format produced by
 * `someXdrObject.toXDR('base64')`.
 *
 * @param value - The value to test.
 * @returns `true` if `value` is a well-formed base64 string.
 *
 * @example
 * ```ts
 * if (!isXdrBase64(raw)) throw new Error('Expected base64-encoded XDR')
 * ```
 */
export function isXdrBase64(value: unknown): value is XdrBase64 {
  if (typeof value !== 'string' || value.length === 0) return false
  // Base64 alphabet + padding; length must be a multiple of 4
  return /^[A-Za-z0-9+/]*={0,2}$/.test(value) && value.length % 4 === 0
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

/**
 * Runtime type-guard for {@link HexString}.
 *
 * Validates that `value` is a non-empty string containing only lowercase
 * hexadecimal characters (`0-9`, `a-f`) with an even number of characters
 * (each byte is two hex digits).
 *
 * @param value - The value to test.
 * @returns `true` if `value` is a well-formed lowercase hex string.
 *
 * @example
 * ```ts
 * if (!isHexString(raw)) throw new Error('Expected a hex-encoded value')
 * ```
 */
export function isHexString(value: unknown): value is HexString {
  return typeof value === 'string' && value.length > 0 && /^[0-9a-f]+$/.test(value) && value.length % 2 === 0
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
 * Runtime type-guard for {@link NetworkPassphrase}.
 *
 * A valid network passphrase is any non-empty string. This guard intentionally
 * does not restrict to known passphrases so that custom or private networks
 * are supported. Use `resolveNetworkPassphrase` (from `constants.ts`) for
 * stricter validation against the known Stellar network passphrases.
 *
 * @param value - The value to test.
 * @returns `true` if `value` is a non-empty string.
 */
export function isNetworkPassphrase(value: unknown): value is NetworkPassphrase {
  return typeof value === 'string' && value.length > 0
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

/**
 * Runtime type-guard for {@link RpcUrl}.
 *
 * Validates that `value` is a string starting with `"https://"` or
 * `"http://"`. HTTPS is strongly recommended for production use to prevent
 * man-in-the-middle attacks on RPC responses.
 *
 * @param value - The value to test.
 * @returns `true` if `value` is a URL with an HTTP or HTTPS scheme.
 */
export function isRpcUrl(value: unknown): value is RpcUrl {
  return typeof value === 'string' && /^https?:\/\/.+/.test(value)
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
 * Runtime type-guard for {@link FeeStroops}.
 *
 * A valid fee-in-stroops value is a decimal string representing a
 * non-negative integer. It must contain only digit characters and must not
 * be empty.
 *
 * @param value - The value to test.
 * @returns `true` if `value` is a non-negative decimal integer string.
 */
export function isFeeStroops(value: unknown): value is FeeStroops {
  return typeof value === 'string' && /^\d+$/.test(value)
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

/**
 * Runtime type-guard for {@link SequenceNumber}.
 *
 * A valid sequence number is a decimal string representing a non-negative
 * integer. Sequence numbers are 64-bit values serialised as strings to avoid
 * JavaScript's `Number.MAX_SAFE_INTEGER` precision ceiling.
 *
 * @param value - The value to test.
 * @returns `true` if `value` is a non-negative decimal integer string.
 */
export function isSequenceNumber(value: unknown): value is SequenceNumber {
  return typeof value === 'string' && /^\d+$/.test(value)
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

/**
 * Runtime type-guard for {@link HistoryEntryId}.
 *
 * A valid history entry ID follows the format `"<base36-timestamp>-<random-suffix>"`:
 * two alphanumeric segments (base-36 characters: `0-9`, `a-z`) joined by a
 * single hyphen. This matches the format generated by
 * `TransactionHistory.generateId()`.
 *
 * @param value - The value to test.
 * @returns `true` if `value` matches the expected history entry ID format.
 */
export function isHistoryEntryId(value: unknown): value is HistoryEntryId {
  return typeof value === 'string' && /^[0-9a-z]+-[0-9a-z]+$/.test(value)
}
