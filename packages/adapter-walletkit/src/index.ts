import { WalletError, type WalletAdapter, type WalletCapabilities } from '@soroban-resurrect/sdk'
import { asStellarPublicKey, asXdrBase64 } from '@soroban-resurrect/sdk'

/**
 * Minimal surface of `StellarWalletsKit` from
 * [`@creit.tech/stellar-wallets-kit`](https://github.com/Creit-Tech/Stellar-Wallets-Kit)
 * that this adapter depends on. The real class has many more members; we only
 * type what we call so the Kit stays a peer dependency.
 */
export interface StellarWalletsKitLike {
  getAddress(): Promise<{ address: string }>
  signTransaction(
    xdr: string,
    opts?: {
      address?: string
      networkPassphrase?: string
    },
  ): Promise<{ signedTxXdr: string; signerAddress?: string }>
}

/** Normalizes an unknown thrown value into an `Error` with a `WalletKit:` prefix. */
function toWalletKitError(err: unknown): WalletError {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : err && typeof err === 'object' && 'message' in err
          ? String(err.message)
          : 'unknown error'
  const lower = message.toLowerCase()
  const code = /reject|declin|cancel|denied/.test(lower)
    ? 'USER_REJECTED'
    : /network|chain/.test(lower)
      ? 'NETWORK_MISMATCH'
      : /not connected|unavailable/.test(lower)
        ? 'NOT_CONNECTED'
        : 'UNKNOWN'
  return new WalletError(code, `WalletKit: ${message}`, err)
}

/**
 * Options for {@link WalletKitAdapter}.
 */
export interface WalletKitAdapterOptions {
  /**
   * A configured `StellarWalletsKit` instance. You are responsible for calling
   * `kit.setWallet(...)` (or letting the built-in modal do so) before signing.
   */
  kit: StellarWalletsKitLike
}

/**
 * WalletAdapter implementation that wraps Stellar's official
 * [`@creit.tech/stellar-wallets-kit`](https://github.com/Creit-Tech/Stellar-Wallets-Kit).
 *
 * Every wallet the Kit can connect to (Freighter, xBull, Albedo, LOBSTR, Rabet,
 * Ledger via the Kit, WalletConnect, …) becomes usable with the SDK — including
 * its automatic archive-restore support — through a single adapter. Signing is
 * delegated to the Kit's currently-selected signer.
 *
 * @example
 * ```ts
 * import { StellarWalletsKit, WalletNetwork, FREIGHTER_ID } from '@creit.tech/stellar-wallets-kit'
 * import { WalletKitAdapter } from '@soroban-resurrect/adapter-walletkit'
 *
 * const kit = new StellarWalletsKit({
 *   network: WalletNetwork.TESTNET,
 *   selectedWalletId: FREIGHTER_ID,
 *   modules: allowAllModules(), // or a curated list of wallet modules
 * })
 *
 * // Let the user pick a wallet (or call kit.setWallet(id) directly).
 * await kit.openModal({ onWalletSelected: (w) => kit.setWallet(w.id) })
 *
 * const wallet = new WalletKitAdapter({ kit })
 * const result = await sr.submitWithRestore({ transaction, wallet })
 * ```
 */
export class WalletKitAdapter implements WalletAdapter {
  /**
   * The Kit delegates to whichever signer is active. All of the Kit's built-in
   * signers sign full transaction envelopes (fee-bump included) but none expose
   * CAP-0046 per-entry signing through the Kit's `signTransaction` surface, so
   * `signAuthEntry` is `false`. `hardware` is left unset ("unknown") because it
   * depends on the selected wallet.
   */
  readonly capabilities: WalletCapabilities = {
    signAuthEntry: false,
    feeBump: true,
  }

  private readonly kit: StellarWalletsKitLike

  constructor(options: WalletKitAdapterOptions) {
    if (!options?.kit) {
      throw new Error(
        'WalletKitAdapter: a `StellarWalletsKit` instance is required. ' +
          'Pass it as `new WalletKitAdapter({ kit })`.',
      )
    }
    this.kit = options.kit
  }

  async isConnected(): Promise<boolean> {
    try {
      const { address } = await this.kit.getAddress()
      return Boolean(address)
    } catch {
      return false
    }
  }

  async getPublicKey() {
    return this.connect()
  }

  async connect() {
    try {
      const { address } = await this.kit.getAddress()
      return asStellarPublicKey(address)
    } catch (err) {
      throw toWalletKitError(err)
    }
  }

  async signTransaction(tx: string, opts?: { networkPassphrase?: string; network?: string }) {
    try {
      const { address } = await this.kit.getAddress()
      const { signedTxXdr } = await this.kit.signTransaction(tx, {
        address,
        networkPassphrase: opts?.networkPassphrase,
      })
      return asXdrBase64(signedTxXdr)
    } catch (err) {
      throw toWalletKitError(err)
    }
  }
}
