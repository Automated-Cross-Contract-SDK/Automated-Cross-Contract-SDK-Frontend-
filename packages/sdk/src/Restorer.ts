import { rpc, Account } from '@stellar/stellar-sdk'
import { TransactionBuilder, Operation, Transaction, xdr } from '@stellar/stellar-sdk'
import { SorobanResurrectConfig } from './types.js'
import { DEFAULT_NETWORK_PASSPHRASE, RESTORE_FEE_MULTIPLIER } from './constants.js'

/** Parameters for building a restore transaction. */
export interface BuildRestoreTxParams {
  /** Soroban RPC server instance. */
  server: rpc.Server
  /** Source account public key. */
  sourcePublicKey: string
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
  sequenceNumber?: string
}

/**
 * Builds a restore transaction that extends the TTL of archived ledger entries.
 * The fee is calculated as minResourceFee * RESTORE_FEE_MULTIPLIER.
 *
 * To avoid sequence-number race conditions when building multiple transactions
 * concurrently for the same source, provide either the `account` or `sequenceNumber`
 * parameter. If neither is provided, this function will fetch the account from RPC,
 * which may cause the second concurrent call to get an out-of-sync sequence number.
 */
export async function buildRestoreTransaction(params: BuildRestoreTxParams): Promise<Transaction> {
  const { sourcePublicKey, transactionData, minResourceFee, config, account: preFetched, sequenceNumber } = params

  const networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE
  const restoreFeeMultiplier = (config as Required<typeof config>).restoreFeeMultiplier ?? RESTORE_FEE_MULTIPLIER

  let account = preFetched
  if (!account) {
    if (sequenceNumber !== undefined) {
      account = new Account(sourcePublicKey, sequenceNumber)
    } else {
      account = await params.server.getAccount(sourcePublicKey)
    }
  }

  const restoreFee = (minResourceFee * restoreFeeMultiplier).toString()

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

/**
 * Polls for a transaction to reach a terminal status (SUCCESS or FAILED).
 *
 * Uses exponential backoff with jitter between polls to avoid hammering
 * the RPC endpoint. Delay starts at 100ms and doubles on each retry, capped at
 * pollIntervalMs, with random jitter of ±50%.
 */
export async function waitForTransaction(
  server: rpc.Server,
  hash: string,
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
 * Extracts the XDR operations from a Transaction object, handling both
 * regular (v0, v1) and fee-bump envelope formats.
 *
 * Fee-bump transactions wrap an inner transaction. This function extracts
 * the operations from the inner transaction regardless of envelope format.
 *
 * Throws an error if an unknown or unsupported envelope type is encountered.
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

    if (innerType.name === 'envelopeTypeTx') {
      const innerV1 = innerEnvelope.value() as xdr.TransactionV1Envelope
      return innerV1.tx().operations()
    }

    // Unknown inner envelope type
    throw new Error(
      `Unknown or unsupported inner envelope type in fee-bump transaction: ${innerType.name}. ` +
        `Expected envelopeTypeTxV0 or envelopeTypeTx.`,
    )
  }

  // Handle regular V0 transactions
  if (envelopeType.name === 'envelopeTypeTxV0') {
    const v0Envelope = envelope.value() as xdr.TransactionV0Envelope
    return v0Envelope.tx().operations()
  }

  // Handle regular V1 transactions (typically "envelopeTypeTx")
  if (envelopeType.name === 'envelopeTypeTx') {
    const v1Envelope = envelope.value() as xdr.TransactionV1Envelope
    return v1Envelope.tx().operations()
  }

  // Unknown envelope type
  throw new Error(
    `Unknown or unsupported envelope type: ${envelopeType.name}. ` +
      `Expected envelopeTypeTxV0, envelopeTypeTx, or envelopeTypeTxFeeBump.`,
  )
}

/**
 * Rebuilds the original transaction after a successful restore.
 * Fetches the latest account sequence number, re-signs with the
 * restored footprint, and re-simulates to assemble the final transaction.
 *
 * Reuses the original transaction's timeout if set, otherwise defaults to 30 seconds.
 *
 * Throws if the re-simulation still indicates archived entries or an error.
 */
export async function buildOriginalAfterRestore(
  server: rpc.Server,
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
 * Throws if the simulation returns an error or indicates archived entries.
 */
export async function prepareTransaction(
  server: rpc.Server,
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
