import { xdr } from '@stellar/stellar-sdk'
import { asXdrBase64, type XdrBase64 } from './branded-types.js'

/**
 * Serializes a ledger key to its canonical base64 XDR representation.
 *
 * The returned value is deterministic for a given `LedgerKey` and can be used
 * as an identity in caches, diagnostics, and persisted data. It is the Stellar
 * SDK's base64-encoded XDR, not a human-readable or version-independent JSON
 * representation.
 *
 * @param key - Any supported Stellar `LedgerKey` XDR value.
 * @returns The key's canonical base64 XDR representation.
 */
export function serializeLedgerKey(key: xdr.LedgerKey): XdrBase64 {
  return asXdrBase64(key.toXDR('base64'))
}
