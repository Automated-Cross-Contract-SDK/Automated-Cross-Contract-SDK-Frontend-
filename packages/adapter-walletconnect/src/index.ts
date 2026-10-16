import type { WalletAdapter, WalletAdapterEvent, WalletCapabilities } from '@soroban-resurrect/sdk'
import { WalletError, asStellarPublicKey, asXdrBase64 } from '@soroban-resurrect/sdk'

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
  on?(event: string, listener: (payload: unknown) => void): void
  off?(event: string, listener: (payload: unknown) => void): void
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
function toWalletConnectError(err: unknown): WalletError {
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
      : 'UNKNOWN'
  return new WalletError(code, `WalletConnect: ${message}`, err)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
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
  private namespaces: WalletConnectSessionLike['namespaces']
  private readonly listeners = new Set<(event: WalletAdapterEvent) => void>()
  private listening = false
  private readonly handleSessionUpdate = (payload: unknown): void => {
    if (!isRecord(payload) || payload.topic !== this.session.topic || !isRecord(payload.params)) {
      return
    }
    const namespaces = payload.params.namespaces
    if (!isRecord(namespaces)) return

    const previousAddress = this.getCurrentAddress()
    this.namespaces = namespaces as WalletConnectSessionLike['namespaces']
    const nextAddress = this.getCurrentAddress()
    if (previousAddress !== nextAddress) {
      this.emit({
        type: 'accountChanged',
        publicKey: nextAddress ? asStellarPublicKey(nextAddress) : null,
      })
      if (Boolean(previousAddress) !== Boolean(nextAddress)) {
        this.emit({ type: 'connectionChanged', connected: Boolean(nextAddress) })
      }
    }
  }
  private readonly handleSessionDelete = (payload: unknown): void => {
    if (!isRecord(payload) || payload.topic !== this.session.topic) return
    const wasConnected = Boolean(this.getCurrentAddress())
    this.namespaces = {}
    if (wasConnected) {
      this.emit({ type: 'accountChanged', publicKey: null })
      this.emit({ type: 'connectionChanged', connected: false })
    }
  }

  constructor(options: WalletConnectAdapterOptions) {
    const { client, session, networkPassphrase } = options
    if (!client || !session) {
      throw new Error('WalletConnectAdapter: both `client` and `session` are required.')
    }

    this.client = client
    this.session = session
    this.namespace = options.namespace ?? 'stellar'
    this.chainId = passphraseToChainId(networkPassphrase)
    this.namespaces = session.namespaces

    const ns = this.namespaces[this.namespace]
    if (!ns || ns.accounts.length === 0) {
      throw new Error(
        `WalletConnectAdapter: session has no "${this.namespace}" namespace accounts.`,
      )
    }

    // Network passphrase verification: the session must include an account on
    // the CAIP-2 chain the dApp expects, otherwise signatures would be for the
    // wrong network.
    const match = ns.accounts.map(parseStellarAccount).find((acc) => acc.chainId === this.chainId)
    if (!match) {
      throw new Error(
        `WalletConnectAdapter: session does not grant a Stellar account on ` +
          `"${this.chainId}" (network passphrase mismatch). Granted: ${ns.accounts.join(', ')}`,
      )
    }
    if (!ns.methods.includes(STELLAR_WC_METHODS.signXDR)) {
      throw new Error(
        `WalletConnectAdapter: session does not grant the "${STELLAR_WC_METHODS.signXDR}" method.`,
      )
    }
  }

  async isConnected(): Promise<boolean> {
    return Boolean(this.session.topic && this.getCurrentAddress())
  }

  async getPublicKey() {
    return this.connect()
  }

  async connect() {
    const address = this.getCurrentAddress()
    if (!address) {
      throw new WalletError(
        'NOT_CONNECTED',
        `WalletConnectAdapter: session no longer grants an account on "${this.chainId}".`,
      )
    }
    return asStellarPublicKey(address)
  }

  async getNetwork(): Promise<string> {
    const accounts = this.namespaces[this.namespace]?.accounts ?? []
    const activeAccount = accounts
      .map(parseStellarAccount)
      .find(
        ({ chainId }) =>
          chainId === STELLAR_WC_CHAINS.public || chainId === STELLAR_WC_CHAINS.testnet,
      )
    if (activeAccount?.chainId === STELLAR_WC_CHAINS.public) return PASSPHRASE.public
    if (activeAccount?.chainId === STELLAR_WC_CHAINS.testnet) return PASSPHRASE.testnet
    if (accounts.length > 0) {
      throw new WalletError(
        'NETWORK_MISMATCH',
        `WalletConnect: session no longer grants an account on a supported Stellar network.`,
      )
    }
    throw new WalletError('NOT_CONNECTED', 'WalletConnect: session no longer grants an account.')
  }

  private getCurrentAddress(): string | undefined {
    const ns = this.namespaces[this.namespace]
    if (!ns) return undefined
    return ns.accounts.map(parseStellarAccount).find((account) => account.chainId === this.chainId)
      ?.address
  }

  subscribe(listener: (event: WalletAdapterEvent) => void): () => void {
    if (!this.client.on || !this.client.off) {
      throw new Error(
        'WalletConnectAdapter: the supplied client does not support session event subscriptions.',
      )
    }
    this.listeners.add(listener)
    if (!this.listening) {
      this.client.on('session_update', this.handleSessionUpdate)
      this.client.on('session_delete', this.handleSessionDelete)
      this.listening = true
    }

    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.listening) {
        this.client.off?.('session_update', this.handleSessionUpdate)
        this.client.off?.('session_delete', this.handleSessionDelete)
        this.listening = false
      }
    }
  }

  private emit(event: WalletAdapterEvent): void {
    for (const listener of Array.from(this.listeners)) {
      listener(event)
    }
  }

  async signTransaction(tx: string, _opts?: { networkPassphrase?: string; network?: string }) {
    try {
      if (!this.getCurrentAddress()) {
        throw new Error(`session no longer grants an account on "${this.chainId}"`)
      }

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
