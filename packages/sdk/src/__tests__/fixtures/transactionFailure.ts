/**
 * Real base64-encoded Stellar/Soroban XDR fixtures for
 * {@link parseTransactionFailure} unit tests.
 *
 * Each constant is a genuine XDR structure produced with
 * `@stellar/stellar-sdk`'s `xdr` builders and round-tripped through
 * `fromXDR`/`toXDR`. Regenerate with:
 *
 * ```js
 * import pkg from '@stellar/stellar-sdk'
 * const { xdr } = pkg
 * const txFailed = (fee, op) =>
 *   new xdr.TransactionResult({
 *     feeCharged: xdr.Int64.fromString(fee),
 *     result: xdr.TransactionResultResult.txFailed([op]),
 *     ext: new xdr.TransactionResultExt(0),
 *   }).toXDR('base64')
 * ```
 */

/** `txFAILED` with a single `invokeHostFunctionTrapped` operation result. */
export const INVOKE_TRAPPED_RESULT_XDR = 'AAAAAAAAMDn/////AAAAAQAAAAAAAAAY/////gAAAAA='

/** `txFAILED` with a single `invokeHostFunctionEntryArchived` operation result. */
export const INVOKE_ARCHIVED_RESULT_XDR = 'AAAAAAAAA+f/////AAAAAQAAAAAAAAAY/////AAAAAA='

/** A `fn_call` diagnostic event: `["fn_call", "transfer"] -> "transfer(from, to, amount)"`. */
export const DIAG_FN_CALL_XDR =
  'AAAAAAAAAAAAAAAAAAAAAgAAAAAAAAACAAAADwAAAAdmbl9jYWxsAAAAAA8AAAAIdHJhbnNmZXIAAAAOAAAAGnRyYW5zZmVyKGZyb20sIHRvLCBhbW91bnQpAAA='

/**
 * The Soroban host `error` diagnostic event emitted on revert:
 * `["error", Error(Contract, #3)] -> ["escalating Error(Contract, #3) to VM trap
 * from failed host function call: require_auth"]`.
 */
export const DIAG_ERROR_XDR =
  'AAAAAAAAAAAAAAAAAAAAAgAAAAAAAAACAAAADwAAAAVlcnJvcgAAAAAAAAIAAAAAAAAAAwAAABAAAAABAAAAAQAAAA4AAABWZXNjYWxhdGluZyBFcnJvcihDb250cmFjdCwgIzMpIHRvIFZNIHRyYXAgZnJvbSBmYWlsZWQgaG9zdCBmdW5jdGlvbiBjYWxsOiByZXF1aXJlX2F1dGgAAA=='

/** `txINSUFFICIENT_FEE` — a result arm with no per-operation results. */
export const INSUFFICIENT_FEE_RESULT_XDR = 'AAAAAAAAAGT////3AAAAAA=='

/** `txFAILED` where the operation was rejected outright with `opNO_ACCOUNT`. */
export const OP_NO_ACCOUNT_RESULT_XDR = 'AAAAAAAAADL/////AAAAAf////4AAAAA'
