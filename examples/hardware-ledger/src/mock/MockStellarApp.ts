import { Keypair } from '@stellar/stellar-sdk'

/** Simulated time the user takes to review and approve on the device. */
const CONFIRM_DELAY_MS = 1500

/** One software key per BIP44 path, stable for the page's lifetime. */
const keys = new Map<string, Keypair>()
const keyFor = (path: string) => {
  if (!keys.has(path)) keys.set(path, Keypair.random())
  return keys.get(path)!
}

/**
 * Drop-in stand-in for `@ledgerhq/hw-app-str` (aliased in `vite --mode mock`).
 * Implements the three methods `LedgerWalletAdapter` calls and fires a
 * `ledger-mock:confirm` event so the UI can show a "confirm on device" prompt.
 */
export default class MockStellarApp {
  constructor(readonly transport: unknown) {}

  async getAppConfiguration() {
    return { version: '5.0.3-mock' }
  }

  async getPublicKey(path: string) {
    return { publicKey: keyFor(path).publicKey() }
  }

  async signHash(path: string, hash: Uint8Array) {
    window.dispatchEvent(new CustomEvent('ledger-mock:confirm', { detail: path }))
    await new Promise((r) => setTimeout(r, CONFIRM_DELAY_MS))
    return { signature: new Uint8Array(keyFor(path).sign(hash as Buffer)) }
  }
}

/** Mock transport: only `close()` is needed by the adapter. */
export const mockTransport = { close: async () => {} }
