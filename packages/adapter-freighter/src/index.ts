import {
  isConnected as freighterIsConnected,
  requestAccess,
  getAddress,
  getNetwork,
  signTransaction as freighterSignTransaction,
  signAuthEntry as freighterSignAuthEntry,
  WatchWalletChanges,
} from '@stellar/freighter-api'
import {
  WalletError,
  type WalletAdapter,
  type WalletAdapterEvent,
  type WalletCapabilities,
} from '@soroban-resurrect/sdk'
import { asStellarPublicKey, asXdrBase64 } from '@soroban-resurrect/sdk'

/**
 * WalletAdapter implementation for the Freighter browser extension wallet.
 * Wraps `@stellar/freighter-api` to satisfy the SDK's WalletAdapter contract.
 */
export class FreighterAdapter implements WalletAdapter {
  /**
   * Freighter is a software extension wallet. This adapter signs full
   * transaction envelopes (including fee-bump envelopes) via `signTransaction`;
   * it does not wire up CAP-0046 per-entry signing.
   */
  readonly capabilities: WalletCapabilities = {
    signAuthEntry: true,
    feeBump: true,
    hardware: false,
  }

  private readonly listeners = new Set<(event: WalletAdapterEvent) => void>()
  private changeWatcher: InstanceType<typeof WatchWalletChanges> | undefined
  private previousAddress: string | null | undefined

  async isConnected(): Promise<boolean> {
    const result = await freighterIsConnected()
    if ('error' in result && result.error) {
      return false
    }
    return Boolean(result.isConnected)
  }

  async getPublicKey() {
    try {
      const result = await getAddress()
      if ('error' in result && result.error) throw normalizeError(result.error)
      return asStellarPublicKey(result.address)
    } catch (error) {
      if (error instanceof WalletError) throw error
      throw normalizeError(error)
    }
  }

  async connect() {
    try {
      const access = await requestAccess()
      if ('error' in access && access.error) throw normalizeError(access.error)
      return asStellarPublicKey(access.address)
    } catch (error) {
      if (error instanceof WalletError) throw error
      throw normalizeError(error)
    }
  }

  async signTransaction(tx: string, opts?: { networkPassphrase?: string; network?: string }) {
    const address = await getAddress()
    if ('error' in address && address.error) {
      throw new WalletError('NOT_CONNECTED', `Freighter: ${address.error}`, address.error)
    }

    const result = await freighterSignTransaction(tx, {
      networkPassphrase: opts?.networkPassphrase,
      address: address.address,
    })

    if ('error' in result && result.error) {
      throw normalizeError(result.error)
    }

    return asXdrBase64(result.signedTxXdr)
  }

  async getNetwork(): Promise<string> {
    const result = await getNetwork()
    if ('error' in result && result.error) throw normalizeError(result.error)
    return result.networkPassphrase
  }

  subscribe(listener: (event: WalletAdapterEvent) => void): () => void {
    this.listeners.add(listener)

    if (!this.changeWatcher) {
      const watcher = new WatchWalletChanges()
      const result = watcher.watch(({ address }) => {
        const nextAddress = address || null
        if (this.previousAddress === undefined) {
          this.previousAddress = nextAddress
          return
        }
        if (nextAddress === this.previousAddress) return

        const wasConnected = Boolean(this.previousAddress)
        this.previousAddress = nextAddress
        this.emit({
          type: 'accountChanged',
          publicKey: nextAddress ? asStellarPublicKey(nextAddress) : null,
        })
        if (wasConnected !== Boolean(nextAddress)) {
          this.emit({ type: 'connectionChanged', connected: Boolean(nextAddress) })
        }
      })
      if (result.error) {
        this.listeners.delete(listener)
        watcher.stop()
        throw normalizeError(result.error)
      }
      this.changeWatcher = watcher
    }

    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.changeWatcher?.stop()
        this.changeWatcher = undefined
        this.previousAddress = undefined
      }
    }
  }

  private emit(event: WalletAdapterEvent): void {
    for (const listener of Array.from(this.listeners)) {
      listener(event)
    }
  }

  async signAuthEntry(
    authEntryXdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<string> {
    try {
      const result = await freighterSignAuthEntry(authEntryXdr, opts)
      if ('error' in result && result.error) throw normalizeError(result.error)
      if (!result.signedAuthEntry) {
        throw new WalletError('UNKNOWN', 'Freighter: missing signed authorization entry')
      }
      return result.signedAuthEntry.toString('base64')
    } catch (error) {
      if (error instanceof WalletError) throw error
      throw normalizeError(error)
    }
  }
}

function normalizeError(error: unknown): WalletError {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  const code = /reject|declin|cancel|denied/.test(lower)
    ? 'USER_REJECTED'
    : /network/.test(lower)
      ? 'NETWORK_MISMATCH'
      : 'UNKNOWN'
  return new WalletError(code, `Freighter: ${message}`, error)
}
