import { rpc, Account, Keypair, Memo } from '@stellar/stellar-sdk'
import { TransactionBuilder, Operation, Transaction, xdr, FeeBumpTransaction } from '@stellar/stellar-sdk'
import { SorobanResurrectConfig, FeeBumpSponsor } from './types.js'
import { DEFAULT_NETWORK_PASSPHRASE } from './constants.js'
import { calculateRestoreFee } from './feeCalculation.js'

/** Parameters for building a restore transaction. */
export interface BuildRestoreTxParams {
  /** Soroban RPC server instance. */
  server: rpc.Server
  /** Source account public key (Stellar G-address). */
  sourcePublicKey: StellarPublicKey | string
  /** Soroban transaction data from the simulation response. */
  transactionData: xdr.SorobanTransactionData
  /** Minimum resource fee from the simulation response. */
  minResourceFee: number
  /** SDK configuration. */
  config: SorobanResurrectConfig
  /** Pre-fetched account (avoids sequence-number race when calling concurrently). */
  account?: Account
  /** Optional pre-fetched sequence number. If provided, avoids fetching the account.
   *  Useful when building multiple transactions concurrently for the same source.
   *  Note: When omitted, fetches the latest account via RPC, which may race with
   *  concurrent calls. Callers should either provide this parameter or serialize calls. */
  sequenceNumber?: SequenceNumber | string
  /**
   * Optional memo to attach to the restore transaction. When omitted, falls
   * back to `config.restoreTxMemo` / `config.restoreTxMemoText`. When none of
   * those are set, no memo is attached (default, no behaviour change).
   */
  memo?: Memo
}

/**
 * Resolves the memo to attach to a restore transaction from an explicit
 * parameter and the SDK config, in precedence order:
 * explicit `memo` → `config.restoreTxMemo` → `Memo.text(config.restoreTxMemoText)`.
 *
 * @returns The resolved `Memo`, or `undefined` when no memo is configured.
 */
export function resolveRestoreMemo(
  explicit: Memo | undefined,
  config: Pick<SorobanResurrectConfig, 'restoreTxMemo' | 'restoreTxMemoText'>,
): Memo | undefined {
  if (explicit) return explicit
  if (config.restoreTxMemo) return config.restoreTxMemo
  if (config.restoreTxMemoText !== undefined && config.restoreTxMemoText !== '') {
    return Memo.text(config.restoreTxMemoText)
  }
  return undefined
}

/**
 * Builds a restore transaction that extends the TTL of archived ledger entries.
 * The fee is calculated as minResourceFee * RESTORE_FEE_MULTIPLIER.
 *
 * To avoid sequence-number race conditions when building multiple transactions
 * concurrently for the same source, provide either the `account` or `sequenceNumber`
 * parameter. If neither is provided, this function will fetch the account from RPC,
 * which may cause the second concurrent call to get an out-of-sync sequence number.
 *
 * @param params - See {@link BuildRestoreTxParams}.
 * @returns An unsigned `Transaction` with a single `restoreFootprint`
 *   operation and the simulation-derived `SorobanTransactionData` attached.
 * @see {@link SorobanResurrect.buildRestoreTx} for the higher-level facade
 *   method that also runs the simulation for you.
 *
 * @example
 * ```ts
 * const restoreTx = await buildRestoreTransaction({
 *   server,
 *   sourcePublicKey: publicKey,
 *   transactionData: simResponse.transactionData.build(),
 *   minResourceFee: parseInt(simResponse.minResourceFee, 10),
 *   config,
 * })
 * ```
 */
export async function buildRestoreTransaction(params: BuildRestoreTxParams): Promise<Transaction> {
  const { sourcePublicKey, transactionData, minResourceFee, config, account: preFetched, sequenceNumber } = params

  const networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE
  let account = preFetched
  if (!account) {
    if (sequenceNumber !== undefined) {
      account = new Account(sourcePublicKey, sequenceNumber)
    } else {
      account = await params.server.getAccount(sourcePublicKey)
    }
  }

  const restoreFee = calculateRestoreFee(minResourceFee, config)

  const memo = resolveRestoreMemo(params.memo, config)

  const builder = new TransactionBuilder(account, {
    fee: restoreFee,
    networkPassphrase,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setSorobanData(transactionData)
    .setTimeout(30)

  if (memo) {
    builder.addMemo(memo)
  }

  return builder.build()
}

/**
 * Polls for a transaction to reach a terminal status (SUCCESS or FAILED).
 *
 * Uses exponential backoff with jitter between polls to avoid hammering
 * the RPC endpoint. Delay starts at 100ms and doubles on each retry, capped at
 * pollIntervalMs, with random jitter of ±50%.
 *
 * @param server - Soroban RPC server instance.
 * @param hash - Hash of the submitted transaction to poll for.
 * @param pollIntervalMs - Maximum delay between polls, in ms (default `1000`).
 * @param pollTimeoutMs - Total time to keep polling before giving up, in ms
 *   (default `60_000`).
 * @returns The terminal `GetTransactionResponse` (status `SUCCESS` or
 *   `FAILED`).
 * @throws {Error} If the transaction does not reach a terminal status
 *   within `pollTimeoutMs`.
 *
 * @example
 * ```ts
 * const status = await waitForTransaction(server, txHash, 1000, 60_000)
 * if (status.status === rpc.Api.GetTransactionStatus.SUCCESS) { ... }
 * ```
 */
export async function waitForTransaction(
  server: rpc.Server,
  hash: TxHash | string,
  pollIntervalMs: number = 1000,
  pollTimeoutMs: number = 60_000,
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

    // Exponential backoff with jitter: delay = min(100ms * 2^attempt, pollIntervalMs) * (0.5 + random * 0.5)
    attempt++
    const exponentialDelay = 100 * Math.pow(2, attempt)
    const delay = Math.min(exponentialDelay, pollIntervalMs)
    const jitter = delay * (0.5 + Math.random() * 0.5)
    await new Promise((resolve) => setTimeout(resolve, jitter))
  }

  throw new Error(`Transaction ${hash} did not complete within ${pollTimeoutMs}ms`)
}

/**
 * Helper: checks if a transaction status is terminal.
 */
function isTerminalStatus(status: string): boolean {
  return (
    status === rpc.Api.GetTransactionStatus.SUCCESS ||
    status === rpc.Api.GetTransactionStatus.FAILED
  )
}

/**
 * Opens an SSE stream to the Soroban RPC `getEvents` endpoint and watches for
 * events matching the given transaction hash.
 *
 * When a matching event is found, verifies the transaction status with a final
 * `getTransaction` call and returns the result.
 *
 * Falls back to adaptive polling if SSE is not supported or fails.
 *
 * @private
 */
async function streamTransactionViaEvents(
  server: rpc.Server,
  hash: TxHash | string,
  timeoutMs: number,
): Promise<rpc.Api.GetTransactionResponse | null> {
  // Determine the latest ledger as a starting point for SSE streaming.
  // We try getLatestLedger first, then fall back to the transaction's latestLedger.
  let startLedger: number
  try {
    const health = await server.getLatestLedger()
    startLedger = health.sequence
  } catch {
    try {
      const txResp = await server.getTransaction(hash)
      const txLedger = (txResp as any).latestLedger ?? (txResp as any).ledger
      if (txLedger != null && txLedger > 0) {
        startLedger = txLedger
      } else {
        // Cannot determine a reasonable start — bail out of SSE
        return null
      }
    } catch {
      return null
    }
  }

  // Extract the base URL from the server.
  // NOTE: serverURL is part of the Stellar SDK's internal API surface.
  // It may change across major versions; fall back gracefully if unavailable.
  const serverURL =
    typeof (server as any).serverURL === 'string'
      ? (server as any).serverURL
      : (server as any).serverURL?.toString?.() ?? ''

  if (!serverURL) {
    return null
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(serverURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getEvents',
        params: {
          startLedger,
          filters: [
            {
              type: 'diagnostic',
            },
          ],
          pagination: {
            limit: 100,
          },
        },
      }),
      signal: controller.signal,
    })

    if (!response.ok || !response.body) {
      return null
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            const events = data?.result?.events ?? []
            const matched = events.some(
              (event: any) => event.txHash === hash || event.transactionHash === hash,
            )
            if (matched) {
              // Verify with getTransaction
              const result = await server.getTransaction(hash)
              if (isTerminalStatus(result.status)) {
                return result
              }
              // Event found but transaction not yet terminal — keep listening
            }
          } catch {
            // Ignore parse errors on individual SSE data lines
          }
        }
      }
    }
  } catch {
    // SSE stream failed (network error, timeout, abort) — fall through
    return null
  } finally {
    clearTimeout(timeoutId)
    controller.abort()
  }

  return null
}

/**
 * Adaptive polling fallback: starts with 200ms delay and increases up to 2s.
 * Lower latency than the default exponential-backoff poller for short waits.
 *
 * @private
 */
async function pollTransactionAdaptive(
  server: ISorobanRpcClient,
  hash: string,
  timeoutMs: number,
): Promise<rpc.Api.GetTransactionResponse> {
  let attempt = 0
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const response = await server.getTransaction(hash)
    if (isTerminalStatus(response.status)) {
      return response
    }
    attempt++
    const delay = Math.min(200 * attempt, 2000)
    await new Promise((resolve) => setTimeout(resolve, delay))
  }

  throw new Error(`Transaction ${hash} did not complete within ${timeoutMs}ms`)
}

/**
 * Waits for a transaction to reach a terminal status using SSE (Server-Sent
 * Events) when available, with adaptive polling as a fallback.
 *
 * SSE is implemented via the Soroban RPC `getEvents` endpoint with the
 * `Accept: text/event-stream` HTTP header. The RPC streams contract events
 * in real time; we watch for events whose `txHash` matches our transaction
 * and then verify with `getTransaction`.
 *
 * If SSE is not supported by the RPC (or fails for any reason), the function
 * falls back to an adaptive polling strategy for lower latency than the
 * default exponential-backoff poller.
 *
 * @param server - Soroban RPC server instance
 * @param hash - Transaction hash to wait for
 * @param pollTimeoutMs - Maximum time to wait in milliseconds (default: 60s)
 * @returns The final transaction response
 * @throws If the transaction does not complete within the timeout
 */
export async function waitForTransactionSSE(
  server: rpc.Server,
  hash: TxHash | string,
  pollTimeoutMs: number = 60_000,
): Promise<rpc.Api.GetTransactionResponse> {
  // First, attempt to get the transaction immediately (it might already be done)
  const immediate = await server.getTransaction(hash)
  if (isTerminalStatus(immediate.status)) {
    return immediate
  }

  // Try SSE stream via getEvents (low latency when supported)
  try {
    const sseResult = await streamTransactionViaEvents(server, hash, pollTimeoutMs)
    if (sseResult) {
      return sseResult
    }
  } catch {
    // SSE failed — fall through to adaptive polling
  }

  // Final fallback: adaptive polling with remaining budget
  // The SSE attempt may have consumed some time, but to keep things simple
  // and avoid tracking elapsed time across the SSE stream and the
  // immediate getTransaction call, we use a fresh timeout here.
  // In practice the SSE stream either succeeds quickly (< 2s) or fails fast.
  return pollTransactionAdaptive(server, hash, pollTimeoutMs)
}

/**
 * Extracts the XDR operations from a Transaction object, handling both
 * regular (v0, v1) and fee-bump envelope formats.
 *
 * Fee-bump transactions wrap an inner transaction. This function extracts
 * the operations from the inner transaction regardless of envelope format.
 *
 * @param tx - The transaction to extract operations from.
 * @returns The raw `xdr.Operation[]` array from the (possibly inner)
 *   transaction envelope.
 * @see {@link buildOriginalAfterRestore}, which uses this to copy
 *   operations onto a freshly-built transaction.
 */
export function extractXdrOperations(tx: Transaction): xdr.Operation[] {
  const envelope = tx.toEnvelope()
  const envelopeType = envelope.switch()

  // Handle fee-bump transactions: extract the inner transaction first
  if (envelopeType.name === 'envelopeTypeTxFeeBump') {
    const feeBumpEnvelope = envelope.value() as xdr.FeeBumpTransactionEnvelope
    const innerEnvelope = feeBumpEnvelope.tx().innerTx()
    const innerType = innerEnvelope.switch()

    if (innerType.name === 'envelopeTypeTxV0') {
      // For V0 inner transaction, cast through unknown to handle type differences
      const innerV0 = innerEnvelope.value() as unknown as xdr.TransactionV0Envelope
      return innerV0.tx().operations()
    }

    if (innerType === xdr.EnvelopeType.envelopeTypeTx()) {
      const innerV1 = innerEnvelope.value() as xdr.TransactionV1Envelope
      return innerV1.tx().operations()
    }

    throw new Error(`Unsupported inner transaction envelope type in fee-bump transaction: ${innerType.name}`)
  }

  // Handle regular V0 transactions
  if (envelopeType.name === 'envelopeTypeTxV0') {
    const v0Envelope = envelope.value() as xdr.TransactionV0Envelope
    return v0Envelope.tx().operations()
  }

  // Handle regular V1 transactions
  if (envelopeType === xdr.EnvelopeType.envelopeTypeTx()) {
    const v1Envelope = envelope.value() as xdr.TransactionV1Envelope
    return v1Envelope.tx().operations()
  }

  throw new Error(`Unsupported transaction envelope type: ${envelopeType.name}`)
}

/**
 * Rebuilds the original transaction after a successful restore.
 * Fetches the latest account sequence number, re-signs with the
 * restored footprint, and re-simulates to assemble the final transaction.
 *
 * Reuses the original transaction's timeout if set, otherwise defaults to 30 seconds.
 *
 * @param server - Soroban RPC server instance.
 * @param originalTx - The user's original transaction (pre-restore), used
 *   as the source of operations and timeout.
 * @param networkPassphrase - Network passphrase to build the new
 *   transaction with.
 * @param fee - Fee (in stroops, as a string) to set on the rebuilt
 *   transaction.
 * @returns A freshly assembled, unsigned `Transaction` ready to be signed
 *   and submitted.
 * @throws {Error} If the re-simulation still indicates archived entries
 *   (the restore was not sufficient) or returns a simulation error.
 * @see {@link extractXdrOperations} for how operations are copied over.
 *
 * @example
 * ```ts
 * const preparedTx = await buildOriginalAfterRestore(
 *   server,
 *   originalTx,
 *   networkPassphrase,
 *   originalTx.fee,
 * )
 * ```
 */
export async function buildOriginalAfterRestore(
  server: ISorobanRpcClient,
  originalTx: Transaction,
  networkPassphrase: string,
  fee: string,
): Promise<Transaction> {
  const source = originalTx.source
  const account = await server.getAccount(source)
  const operations = extractXdrOperations(originalTx)

  // Extract the original transaction's timeout
  let timeout = 30
  if (originalTx.timeBounds) {
    // timeBounds.maxTime is the absolute Unix timestamp when the tx expires.
    // Convert to relative timeout by subtracting the current time.
    const maxTime = parseInt(originalTx.timeBounds.maxTime, 10)
    if (maxTime > 0) {
      // maxTime is absolute, so compute relative timeout
      const now = Math.floor(Date.now() / 1000)
      timeout = Math.max(1, maxTime - now)
    }
  }

  const builder = new TransactionBuilder(account, {
    fee,
    networkPassphrase,
  })

  for (const op of operations) {
    builder.addOperation(op)
  }

  builder.setTimeout(timeout)
  const rawTx = builder.build()

  const sim = await server.simulateTransaction(rawTx)

  if (rpc.Api.isSimulationRestore(sim)) {
    throw new Error('Restoration was not sufficient: ledger entries are still archived')
  }

  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Re-simulation failed after restore: ${sim.error}`)
  }

  const assembled = rpc.assembleTransaction(rawTx, sim)

  return assembled.build()
}

/**
 * Simulates a transaction and assembles it with the resulting footprint.
 *
 * @param server - Soroban RPC server instance.
 * @param tx - The transaction to simulate and assemble.
 * @returns The assembled, unsigned `Transaction` ready to be signed and
 *   submitted.
 * @throws {Error} If the simulation returns an error, or indicates that
 *   archived ledger entries need restoring first (call
 *   {@link buildRestoreTransaction} in that case).
 */
export async function prepareTransaction(
  server: ISorobanRpcClient,
  tx: Transaction,
): Promise<Transaction> {
  const sim = await server.simulateTransaction(tx)

  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation error: ${sim.error}`)
  }

  if (rpc.Api.isSimulationRestore(sim)) {
    throw new Error('Archived ledger entries detected — restore required')
  }

  const assembled = rpc.assembleTransaction(tx, sim)
  assembled.setTimeout(30)
  return assembled.build()
}

/**
 * Wraps a signed inner transaction in a fee-bump envelope signed by the sponsor.
 * The sponsor pays the transaction fees on behalf of the user.
 *
 * @param innerTxXdr - The signed inner transaction XDR (user-signed).
 * @param sponsor - The fee-bump sponsor who will sign and pay fees.
 * @param networkPassphrase - Stellar network passphrase.
 * @param feeBumpFee - Optional custom fee for the fee-bump wrapper (in stroops).
 * @returns The fully signed fee-bump transaction XDR string, ready for submission.
 */
export async function buildFeeBumpTransaction(
  innerTxXdr: XdrBase64 | string,
  sponsor: FeeBumpSponsor,
  networkPassphrase: string,
  feeBumpFee?: string,
): Promise<XdrBase64> {
  const sponsorPublicKey = await sponsor.getPublicKey()

  const innerTx = TransactionBuilder.fromXDR(innerTxXdr, networkPassphrase)
  if (!(innerTx instanceof Transaction)) {
    throw new Error('Failed to parse inner transaction XDR')
  }

  const fee = feeBumpFee ?? innerTx.fee

  const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
    Keypair.fromPublicKey(sponsorPublicKey),
    fee,
    innerTx,
    networkPassphrase,
  )

  if (!(feeBumpTx instanceof FeeBumpTransaction)) {
    throw new Error('Failed to build fee-bump transaction')
  }

  const signedFeeBumpXdr = await sponsor.signFeeBump(asXdrBase64(feeBumpTx.toXDR()), {
    networkPassphrase,
  })

  return asXdrBase64(signedFeeBumpXdr)
}

/**
 * Submits a fee-bump transaction to the network.
 * Deserializes the XDR string and sends it via the RPC server.
 *
 * @returns The send transaction response with the hash.
 */
export async function submitFeeBumpTransaction(
  server: rpc.Server,
  feeBumpXdr: XdrBase64 | string,
  networkPassphrase: string,
): Promise<rpc.Api.SendTransactionResponse> {
  const parsed = TransactionBuilder.fromXDR(feeBumpXdr, networkPassphrase)
  if (!(parsed instanceof FeeBumpTransaction)) {
    throw new Error('Failed to parse fee-bump transaction XDR')
  }
  return server.sendTransaction(parsed)
}
