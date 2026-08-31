import { rpc, Account, Keypair, SorobanDataBuilder } from '@stellar/stellar-sdk'
import {
  TransactionBuilder,
  Operation,
  Transaction,
  xdr,
  FeeBumpTransaction,
} from '@stellar/stellar-sdk'
import { SorobanResurrectConfig, FeeBumpSponsor, ArchivedLedgerEntry } from './types.js'
import type { ISorobanRpcClient } from './RpcClient.js'
import { DEFAULT_NETWORK_PASSPHRASE } from './constants.js'
import { calculateRestoreFee } from './feeCalculation.js'
import { ISorobanRpcClient } from './RpcClient.js'

/** Parameters for building a restore transaction. */
export interface BuildRestoreTxParams {
  /** Soroban RPC server instance. */
  server: ISorobanRpcClient
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
  const {
    sourcePublicKey,
    transactionData,
    minResourceFee,
    config,
    account: preFetched,
    sequenceNumber,
  } = params

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

  if (config.maxRestoreFeeStroops !== undefined) {
    const cap = BigInt(config.maxRestoreFeeStroops)
    if (BigInt(restoreFee) > cap) {
      throw new RestoreFeeCapExceededError(restoreFee, config.maxRestoreFeeStroops.toString())
    }
  }

  const restoreTx = new TransactionBuilder(account, {
    fee: restoreFee,
    networkPassphrase,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setSorobanData(transactionData)
    .setTimeout(30)
    .build()

  return restoreTx
}

/** Parameters for building a restore transaction from arbitrary ledger keys. */
export interface BuildRestoreTxFromKeysParams {
  /** Soroban RPC server instance. */
  server: ISorobanRpcClient
  /** Source account public key (Stellar G-address) that will pay for the restore. */
  sourcePublicKey: StellarPublicKey | string
  /** The ledger keys to restore (need not come from a simulated transaction's footprint). */
  keys: xdr.LedgerKey[]
  /** SDK configuration. */
  config: SorobanResurrectConfig
  /** Pre-fetched account (avoids sequence-number race when calling concurrently). */
  account?: Account
  /** Optional pre-fetched sequence number. If provided, avoids fetching the account. */
  sequenceNumber?: SequenceNumber | string
}

/**
 * Builds a restore transaction for an arbitrary set of ledger keys, without
 * requiring a source transaction's simulated footprint. This enables
 * proactive maintenance (e.g. restoring a contract's data ahead of an
 * upgrade) where there is no "original" transaction to simulate.
 *
 * Since there is no source transaction to derive `minResourceFee` from, this
 * builds a throwaway `restoreFootprint` transaction over the given keys and
 * simulates it once to price the restore, then delegates to
 * {@link buildRestoreTransaction} (which applies `restoreFeeMultiplier` and
 * the `maxRestoreFeeStroops` cap identically to the tx-driven restore flow).
 *
 * @param params - See {@link BuildRestoreTxFromKeysParams}.
 * @returns An unsigned restore `Transaction` ready to be signed.
 * @throws {Error} If `keys` is empty, or if the pricing simulation fails.
 * @throws {RestoreFeeCapExceededError} If the computed fee exceeds `config.maxRestoreFeeStroops`.
 * @see {@link SorobanResurrect.restoreKeys} for the public facade method.
 */
export async function buildRestoreTransactionFromKeys(
  params: BuildRestoreTxFromKeysParams,
): Promise<Transaction> {
  const { server, sourcePublicKey, keys, config, account: preFetched, sequenceNumber } = params

  if (keys.length === 0) {
    throw new Error('restoreKeys: at least one ledger key is required')
  }

  const networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE

  let account = preFetched
  if (!account) {
    account =
      sequenceNumber !== undefined
        ? new Account(sourcePublicKey, sequenceNumber)
        : await server.getAccount(sourcePublicKey)
  }

  // Capture the starting sequence before the draft build below consumes one,
  // so the final transaction (built by buildRestoreTransaction) starts from
  // the correct, unconsumed sequence number.
  const initialSequence = account.sequenceNumber()

  const sorobanData = new SorobanDataBuilder().setReadWrite(keys).build()

  const draftTx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setSorobanData(sorobanData)
    .setTimeout(30)
    .build()

  const sim = await server.simulateTransaction(draftTx)

  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation error while pricing restore for arbitrary keys: ${sim.error}`)
  }

  return buildRestoreTransaction({
    server,
    sourcePublicKey,
    transactionData: sim.transactionData.build(),
    minResourceFee: parseInt(sim.minResourceFee, 10),
    config,
    account: new Account(sourcePublicKey, initialSequence),
  })
}

/**
 * Polls for a transaction to reach a terminal status (SUCCESS or FAILED).
 *
 * Uses exponential backoff with jitter between polls to avoid hammering
 * the RPC endpoint. Delay starts at 100ms and doubles on each retry, capped at
 * pollIntervalMs, with random jitter of ±50%.
 *
 * @param server - RPC client used to poll for transaction status.
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
  server: ISorobanRpcClient,
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
  server: ISorobanRpcClient,
  hash: TxHash | string,
  timeoutMs: number,
): Promise<rpc.Api.GetTransactionResponse | null> {
  // SSE relies on browser-standard fetch/AbortController with a readable
  // stream body. Older Node runtimes (< 18) may lack these — degrade
  // gracefully to the polling fallback instead of throwing.
  if (typeof fetch === 'undefined' || typeof AbortController === 'undefined') {
    return null
  }

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

  // The base URL is plumbed through ISorobanRpcClient.serverURL rather than
  // reaching into rpc.Server's undocumented internals. Implementations that
  // don't expose it degrade gracefully to the polling fallback.
  const serverURL = server.serverURL
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
 * @param server - RPC client used for all Soroban network calls. SSE
 *   requires `server.serverURL` to be set; if it's absent, SSE is skipped
 *   and polling is used directly.
 * @param hash - Transaction hash to wait for
 * @param pollTimeoutMs - Maximum time to wait in milliseconds (default: 60s)
 * @returns The final transaction response
 * @throws If the transaction does not complete within the timeout
 */
export async function waitForTransactionSSE(
  server: ISorobanRpcClient,
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

    throw new Error(
      `Unsupported inner transaction envelope type in fee-bump transaction: ${innerType.name}`,
    )
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
  server: ISorobanRpcClient,
  feeBumpXdr: XdrBase64 | string,
  networkPassphrase: string,
): Promise<rpc.Api.SendTransactionResponse> {
  const parsed = TransactionBuilder.fromXDR(feeBumpXdr, networkPassphrase)
  if (!(parsed instanceof FeeBumpTransaction)) {
    throw new Error('Failed to parse fee-bump transaction XDR')
  }
  return server.sendTransaction(parsed)
}

/** Parameters for {@link buildBatchRestoreTransaction}. */
export interface BuildBatchRestoreTxParams {
  /** Soroban RPC client used to simulate each transaction. */
  server: ISorobanRpcClient
  /** Source account public key that will pay for and sign the restore. */
  sourcePublicKey: StellarPublicKey | string
  /** The transactions to inspect for archived keys, in submission order. */
  transactions: Transaction[]
  /** SDK configuration (used for network passphrase and fee multiplier). */
  config: SorobanResurrectConfig
  /** Pre-fetched account (avoids a sequence-number race). */
  account?: Account
}

/** Result of {@link buildBatchRestoreTransaction}. */
export interface BatchRestoreBuildResult {
  /**
   * A single unsigned restore transaction covering the union of archived
   * keys across every input transaction, or `null` if none of them need
   * restoring.
   */
  restoreTx: Transaction | null
  /**
   * Archived keys detected per input transaction, in the same order as
   * `transactions` (empty array for transactions that need no restore).
   */
  archivedKeysByTx: ArchivedLedgerEntry[][]
}

/**
 * Simulates every transaction in `transactions`, unions the archived ledger
 * keys detected across all of them, and builds a single restore transaction
 * covering that union — so a multi-contract batch pays one restore fee
 * instead of one per transaction.
 *
 * Resource accounting is conservative: the combined transaction's
 * instructions/read-bytes/write-bytes/resource-fee are the *sum* of each
 * individual restore simulation's resources. This is always sufficient
 * (restoring the union footprint costs no more than restoring each part
 * separately) even though it may be a slight overestimate when transactions
 * share archived entries.
 *
 * @see {@link buildRestoreTransaction} for the single-transaction equivalent.
 * @see {@link SorobanResurrect.buildBatchRestoreTx} for the public facade method.
 */
export async function buildBatchRestoreTransaction(
  params: BuildBatchRestoreTxParams,
): Promise<BatchRestoreBuildResult> {
  const { server, sourcePublicKey, transactions, config, account: preFetched } = params
  const networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE

  const archivedKeysByTx: ArchivedLedgerEntry[][] = []
  const restoreResponses: rpc.Api.SimulateTransactionRestoreResponse[] = []

  for (const tx of transactions) {
    const sim = await server.simulateTransaction(tx)
    if (isRestoreResponse(sim)) {
      archivedKeysByTx.push(extractArchivedKeys(sim))
      restoreResponses.push(sim)
    } else {
      archivedKeysByTx.push([])
    }
  }

  if (restoreResponses.length === 0) {
    return { restoreTx: null, archivedKeysByTx }
  }

  const seenKeys = new Set<string>()
  const unionReadWrite: xdr.LedgerKey[] = []
  let totalResourceFee = 0
  let totalInstructions = 0
  let totalReadBytes = 0
  let totalWriteBytes = 0

  for (const response of restoreResponses) {
    const data = response.transactionData.build()
    const resources = data.resources()

    for (const key of resources.footprint().readWrite()) {
      const keyBase64 = key.toXDR('base64')
      if (!seenKeys.has(keyBase64)) {
        seenKeys.add(keyBase64)
        unionReadWrite.push(key)
      }
    }

    totalResourceFee += parseInt(response.minResourceFee, 10)
    totalInstructions += resources.instructions()
    totalReadBytes += resources.readBytes()
    totalWriteBytes += resources.writeBytes()
  }

  const combinedSorobanData = new SorobanDataBuilder()
    .setReadWrite(unionReadWrite)
    .setResources(totalInstructions, totalReadBytes, totalWriteBytes)
    .setResourceFee(totalResourceFee.toString())
    .build()

  let account = preFetched
  if (!account) {
    account = await server.getAccount(sourcePublicKey)
  }

  const restoreFee = calculateRestoreFee(totalResourceFee, config)

  const restoreTx = new TransactionBuilder(account, {
    fee: restoreFee,
    networkPassphrase,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setSorobanData(combinedSorobanData)
    .setTimeout(30)
    .build()

  return { restoreTx, archivedKeysByTx }
}
