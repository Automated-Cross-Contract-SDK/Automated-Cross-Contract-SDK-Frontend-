import {
  rpc,
  Transaction,
  TransactionBuilder,
  Operation,
  Account,
  xdr,
  SorobanDataBuilder,
} from '@stellar/stellar-sdk'
import type { ISorobanRpcClient } from './RpcClient.js'
import type { SorobanResurrectConfig, WalletAdapter, SorobanResurrectEvents } from './types.js'
import type { TypedEventEmitter, WithIndexSignature } from './EventEmitter.js'
import { getExpiringSoonEntries, type LedgerEntryTTLInfo } from './TTLHelpers.js'
import { calculateRestoreFee } from './feeCalculation.js'
import { isErrorResponse } from './Archiver.js'
import { DEFAULT_NETWORK_PASSPHRASE } from './constants.js'
import { asXdrBase64, asTxHash } from './branded-types.js'

/** Options for {@link watchTTL}. */
export interface TTLWatchOptions {
  /** Wallet used to sign the auto-extend restore transaction (required only when `autoExtend` is enabled). */
  wallet?: WalletAdapter
  /** Polling cadence in ms. Defaults to `config.ttlWatchIntervalMs`. */
  intervalMs?: number
  /** "Expiring soon" threshold in remaining ledgers. Defaults to `config.ttlWatchThreshold`. */
  thresholdLedgers?: number
  /**
   * When `true`, automatically builds, signs (via `wallet`), and submits a
   * restore transaction the moment an entry crosses the threshold, instead
   * of only emitting `ttlLow`. Defaults to `config.ttlWatchAutoExtend`.
   */
  autoExtend?: boolean
  /** Called when a poll cycle or auto-extend submission fails. Polling continues on the next tick. */
  onError?: (error: string) => void
}

/** Handle returned by {@link watchTTL}, used to stop polling. */
export interface TTLWatchHandle {
  /** Stops the watch. Safe to call more than once. */
  stop(): void
}

/**
 * Polls a small, self-contained terminal-status waiter typed against
 * {@link ISorobanRpcClient} (rather than the concrete `rpc.Server`), so
 * `watchTTL` doesn't need a cast to use `Restorer.ts`'s `rpc.Server`-typed
 * `waitForTransaction`.
 */
async function waitForTerminalStatus(
  server: ISorobanRpcClient,
  hash: string,
  pollIntervalMs: number,
  pollTimeoutMs: number,
): Promise<rpc.Api.GetTransactionResponse> {
  const startTime = Date.now()
  let attempt = 0

  while (Date.now() - startTime < pollTimeoutMs) {
    const response = await server.getTransaction(hash)
    if (
      response.status === rpc.Api.GetTransactionStatus.SUCCESS ||
      response.status === rpc.Api.GetTransactionStatus.FAILED
    ) {
      return response
    }
    attempt++
    const exponentialDelay = 100 * Math.pow(2, attempt)
    const delay = Math.min(exponentialDelay, pollIntervalMs)
    const jitter = delay * (0.5 + Math.random() * 0.5)
    await new Promise((resolve) => setTimeout(resolve, jitter))
  }

  throw new Error(`Transaction ${hash} did not complete within ${pollTimeoutMs}ms`)
}

/**
 * Builds an unsigned restore transaction for an arbitrary set of ledger
 * keys — unlike {@link buildRestoreTransaction} in `Restorer.ts`, this
 * doesn't start from a prior transaction's restore-simulation response
 * (watched keys aren't tied to any specific transaction). Instead it
 * simulates a draft `restoreFootprint` operation carrying the target
 * footprint to obtain accurate resource costs, then rebuilds with the
 * real fee.
 */
async function buildRestoreTxForKeys(
  server: ISorobanRpcClient,
  sourcePublicKey: string,
  keys: xdr.LedgerKey[],
  config: SorobanResurrectConfig,
): Promise<Transaction> {
  const networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE
  const accountInfo = await server.getAccount(sourcePublicKey)
  const sequence = accountInfo.sequenceNumber()

  const draftData = new SorobanDataBuilder().setReadWrite(keys).build()
  const draftTx = new TransactionBuilder(new Account(sourcePublicKey, sequence), {
    fee: '1000000',
    networkPassphrase,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setSorobanData(draftData)
    .setTimeout(30)
    .build()

  const sim = await server.simulateTransaction(draftTx)
  if (isErrorResponse(sim)) {
    throw new Error(`Simulation error while building TTL-watch restore transaction: ${sim.error}`)
  }

  const restoreFee = calculateRestoreFee(parseInt(sim.minResourceFee, 10), config)

  return new TransactionBuilder(new Account(sourcePublicKey, sequence), {
    fee: restoreFee,
    networkPassphrase,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setSorobanData(sim.transactionData.build())
    .setTimeout(30)
    .build()
}

/**
 * Proactive TTL-extension mode: polls `getExpiringSoonEntries()` for `keys`
 * on a configurable cadence and either notifies (`ttlLow`) or, when
 * `autoExtend` is on, automatically restores entries before they archive.
 *
 * @param server   - Soroban RPC client.
 * @param config   - Resolved SDK configuration (supplies interval/threshold/autoExtend defaults).
 * @param emitter  - The instance's typed event emitter (fires `ttlLow` / `ttlExtended`).
 * @param keys     - Ledger keys to monitor.
 * @param opts     - Per-call overrides; see {@link TTLWatchOptions}.
 * @returns A {@link TTLWatchHandle} — call `.stop()` to end polling.
 *
 * @example
 * ```ts
 * const handle = resurrect.watchTTL([ledgerKey], {
 *   wallet,
 *   autoExtend: true,
 *   thresholdLedgers: 17_280, // ~24h
 * })
 * resurrect.on('ttlExtended', ({ restoreTxHash }) => console.log('extended', restoreTxHash))
 * // later:
 * handle.stop()
 * ```
 */
export function watchTTL(
  server: ISorobanRpcClient,
  config: Required<SorobanResurrectConfig>,
  emitter: TypedEventEmitter<WithIndexSignature<SorobanResurrectEvents>>,
  keys: xdr.LedgerKey[],
  opts: TTLWatchOptions = {},
): TTLWatchHandle {
  const intervalMs = opts.intervalMs ?? config.ttlWatchIntervalMs
  const thresholdLedgers = opts.thresholdLedgers ?? config.ttlWatchThreshold
  const autoExtend = opts.autoExtend ?? config.ttlWatchAutoExtend

  if (autoExtend && !opts.wallet) {
    throw new Error('watchTTL: `wallet` is required when `autoExtend` is enabled')
  }

  let stopped = false
  let inFlight = false

  const tick = async (): Promise<void> => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      const expiring: LedgerEntryTTLInfo[] = await getExpiringSoonEntries(
        server,
        keys,
        thresholdLedgers,
      )
      if (expiring.length === 0) return

      emitter.emit('ttlLow', expiring)

      if (!autoExtend || !opts.wallet) return

      const wallet = opts.wallet
      const keysToRestore = expiring.map((entry) =>
        xdr.LedgerKey.fromXDR(entry.keyBase64, 'base64'),
      )
      const publicKey = await wallet.getPublicKey()

      const restoreTx = await buildRestoreTxForKeys(server, publicKey, keysToRestore, config)
      const networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE
      const signedXdr = await wallet.signTransaction(asXdrBase64(restoreTx.toXDR()), {
        networkPassphrase,
      })
      const signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase)
      if (!(signedTx instanceof Transaction)) {
        throw new Error('Failed to parse signed TTL auto-extend transaction')
      }

      const sent = await server.sendTransaction(signedTx)
      const hash = asTxHash(sent.hash)
      const status = await waitForTerminalStatus(
        server,
        hash,
        config.pollIntervalMs,
        config.pollTimeoutMs,
      )

      if (status.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        throw new Error('TTL auto-extend restore transaction failed to confirm')
      }

      emitter.emit('ttlExtended', { restoreTxHash: hash, entries: expiring })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      opts.onError?.(message)
    } finally {
      inFlight = false
    }
  }

  const timer = setInterval(() => {
    void tick()
  }, intervalMs)

  // Check once immediately so callers don't wait a full interval to learn
  // their entries are already expiring soon.
  void tick()

  return {
    stop: () => {
      if (stopped) return
      stopped = true
      clearInterval(timer)
    },
  }
}
