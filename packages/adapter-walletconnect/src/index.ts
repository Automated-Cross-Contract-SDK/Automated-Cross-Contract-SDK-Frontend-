import type { WalletAdapter, WalletCapabilities } from '@soroban-resurrect/sdk'
import { asStellarPublicKey, asXdrBase64 } from '@soroban-resurrect/sdk'

/**
 * WalletConnect v2 JSON-RPC methods used by Stellar wallets.
 * @see https://docs.reown.com/advanced/multichain/rpc-reference/stellar-rpc
 */
export const STELLAR_WC_METHODS = {
  signXDR: 'stellar_signXDR',
  signAndSubmitXDR: 'stellar_signAndSubmitXDR',
} as const

/** CAIP-2 chain identifiers for Stellar over WalletConnect. */
export const STELLAR_WC_CHAINS = {
  public: 'stellar:pubnet',
  testnet: 'stellar:testnet',
} as const

/** Stellar network passphrases, for mapping to/from CAIP-2 chain ids. */
const PASSPHRASE = {
  public: 'Public Global Stellar Network ; September 2015',
  testnet: 'Test SDF Network ; September 2015',
} as const

/**
 * The subset of a WalletConnect v2 `SignClient` this adapter relies on. Kept
 * structural so `@walletconnect/sign-client` stays an optional peer dependency
 * and so the client can be mocked in tests.
 */
export interface WalletConnectSignClientLike {
  request<T = unknown>(args: {
    topic: string
    chainId: string
    request: { method: string; params: unknown }
  }): Promise<T>
}

/** Minimal shape of a WalletConnect session namespace entry. */
export interface WalletConnectSessionLike {
  topic: string
  namespaces: Record<
    string,
    {
      accounts: string[]
      methods: string[]
      events: string[]
    }
  >
}

/** Normalizes an unknown thrown value into an `Error` with a `WalletConnect:` prefix. */
function toWalletConnectError(err: unknown): Error {
  if (err instanceof Error) return new Error(`WalletConnect: ${err.message}`)
  if (typeof err === 'string') return new Error(`WalletConnect: ${err}`)
  if (err && typeof err === 'object' && 'message' in err) {
    return new Error(`WalletConnect: ${String((err as { message: unknown }).message)}`)
  }
  return new Error('WalletConnect: unknown error')
}

/** Maps a Stellar network passphrase to its CAIP-2 chain id. Defaults to testnet. */
export function passphraseToChainId(networkPassphrase?: string): string {
  return networkPassphrase === PASSPHRASE.public
    ? STELLAR_WC_CHAINS.public
    : STELLAR_WC_CHAINS.testnet
}

/**
 * Parses `stellar:pubnet:GABC...` → `{ chainId: 'stellar:pubnet', address: 'GABC...' }`.
 */
export function parseStellarAccount(account: string): { chainId: string; address: string } {
  const parts = account.split(':')
  if (parts.length < 3 || parts[0] !== 'stellar') {
    throw new Error(`WalletConnect: malformed Stellar account "${account}"`)
  }
  return { chainId: `${parts[0]}:${parts[1]}`, address: parts.slice(2).join(':') }
}

/**
 * Options for {@link WalletConnectAdapter}.
 */
export interface WalletConnectAdapterOptions {
  /** A connected WalletConnect v2 `SignClient` (or a compatible stub). */
  client: WalletConnectSignClientLike
  /** An approved WalletConnect session for this dApp. */
  session: WalletConnectSessionLike
  /**
   * The Stellar network passphrase the dApp operates on. Used to pick the CAIP-2
   * chain and to verify the session actually granted an account on that network.
   */
  networkPassphrase: string
  /**
   * WalletConnect namespace key. Defaults to `"stellar"`.
   */
  namespace?: string
}

/**
 * WalletAdapter implementation over a Stellar [WalletConnect v2](https://walletconnect.com)
 * session. Enables mobile-first wallets (Stellar apps that speak WalletConnect
 * v2) to be used with the SDK.
 *
 * The adapter does **not** own the pairing lifecycle — you create and approve a
 * `SignClient` session in your app (or a shared connector) and hand the
 * connected client + session to the adapter. This keeps the browser-extension
 * and mobile flows symmetrical and keeps `@walletconnect/sign-client` an
 * optional peer dependency.
 *
 * @example
 * ```ts
 * import SignClient from '@walletconnect/sign-client'
 * import { WalletConnectAdapter } from '@soroban-resurrect/adapter-walletconnect'
 *
 * const client = await SignClient.init({ projectId: '...' })
 * const { uri, approval } = await client.connect({
 *   requiredNamespaces: {
 *     stellar: {
 *       chains: ['stellar:testnet'],
 *       methods: ['stellar_signXDR'],
 *       events: [],
 *     },
 *   },
 * })
 * // show `uri` as a QR code / deep link, then:
 * const session = await approval()
 *
 * const wallet = new WalletConnectAdapter({
 *   client,
 *   session,
 *   networkPassphrase: 'Test SDF Network ; September 2015',
 * })
 * const result = await sr.submitWithRestore({ transaction, wallet })
 * ```
 */
export class WalletConnectAdapter implements WalletAdapter {
  /**
   * WalletConnect Stellar wallets sign full transaction envelopes (fee-bump
   * included) via `stellar_signXDR`. There is no standard method for CAP-0046
   * per-entry signing, so `signAuthEntry` is `false`. `hardware` is left unset
   * because the peer wallet may or may not be hardware-backed.
   */
  readonly capabilities: WalletCapabilities = {
    signAuthEntry: false,
    feeBump: true,
  }

  private readonly client: WalletConnectSignClientLike
  private readonly session: WalletConnectSessionLike
  private readonly namespace: string
  private readonly chainId: string
  private readonly address: string

  constructor(options: WalletConnectAdapterOptions) {
    const { client, session, networkPassphrase } = options
    if (!client || !session) {
      throw new Error('WalletConnectAdapter: both `client` and `session` are required.')
    }

    this.client = client
    this.session = session
    this.namespace = options.namespace ?? 'stellar'
    this.chainId = passphraseToChainId(networkPassphrase)

    const ns = session.namespaces[this.namespace]
    if (!ns || ns.accounts.length === 0) {
      throw new Error(
        `WalletConnectAdapter: session has no "${this.namespace}" namespace accounts.`,
      )
    }

    // Network passphrase verification: the session must include an account on
    // the CAIP-2 chain the dApp expects, otherwise signatures would be for the
    // wrong network.
    const match = ns.accounts
      .map(parseStellarAccount)
      .find((acc) => acc.chainId === this.chainId)
    if (!match) {
      throw new Error(
        `WalletConnectAdapter: session does not grant a Stellar account on ` +
          `"${this.chainId}" (network passphrase mismatch). Granted: ${ns.accounts.join(', ')}`,
      )
    }
    this.address = match.address

    if (!ns.methods.includes(STELLAR_WC_METHODS.signXDR)) {
      throw new Error(
        `WalletConnectAdapter: session does not grant the "${STELLAR_WC_METHODS.signXDR}" method.`,
      )
    }
  }

  async isConnected(): Promise<boolean> {
    return Boolean(this.session.topic && this.address)
  }

  async getPublicKey() {
    return asStellarPublicKey(this.address)
  }

  async signTransaction(
    tx: string,
    _opts?: { networkPassphrase?: string; network?: string },
  ) {
    try {
      const result = await this.client.request<{ signedXDR: string }>({
        topic: this.session.topic,
        chainId: this.chainId,
        request: {
          method: STELLAR_WC_METHODS.signXDR,
          params: { xdr: tx },
        },
      })
      if (!result || typeof result.signedXDR !== 'string') {
        throw new Error('wallet returned no signedXDR')
      }
      return asXdrBase64(result.signedXDR)
    } catch (err) {
      throw toWalletConnectError(err)
    }
  }
}
