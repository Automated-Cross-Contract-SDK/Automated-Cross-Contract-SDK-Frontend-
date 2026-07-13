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
}

/**
 * Builds a restore transaction that extends the TTL of archived ledger entries.
 * The fee is calculated as minResourceFee * RESTORE_FEE_MULTIPLIER.
 */
export async function buildRestoreTransaction(params: BuildRestoreTxParams): Promise<Transaction> {
  const { sourcePublicKey, transactionData, minResourceFee, config, account: preFetched } = params

  const networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE

  const account = preFetched ?? (await params.server.getAccount(sourcePublicKey))

  const restoreFee = (minResourceFee * RESTORE_FEE_MULTIPLIER).toString()

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
 * the RPC endpoint. The base interval doubles on each retry, capped at
 * the configured pollIntervalMs, with random jitter of ±50%.
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

    // Exponential backoff with jitter: delay = min(base * 2^attempt, pollIntervalMs) * (0.5 + random * 0.5)
    attempt++
    const delay = Math.min(pollIntervalMs, 100 * Math.pow(2, attempt))
    const jitter = delay * (0.5 + Math.random() * 0.5)
    await new Promise((resolve) => setTimeout(resolve, jitter))
  }

  throw new Error(`Transaction ${hash} did not complete within ${pollTimeoutMs}ms`)
}

/**
 * Extracts the XDR operations from a Transaction object, handling both
 * v0 and v1 envelope formats.
 */
export function extractXdrOperations(tx: Transaction): xdr.Operation[] {
  const envelope = tx.toEnvelope()
  const envelopeType = envelope.switch()

  if (envelopeType === xdr.EnvelopeType.envelopeTypeTxV0()) {
    const v0Envelope = envelope.value() as xdr.TransactionV0Envelope
    return v0Envelope.tx().operations()
  }

  if (envelopeType === xdr.EnvelopeType.envelopeTypeTxFeeBump()) {
    const feeBumpEnvelope = envelope.value() as xdr.FeeBumpTransactionEnvelope
    const innerEnvelope = feeBumpEnvelope.tx().innerTx()
    const innerType = innerEnvelope.switch()
    if (innerType === xdr.EnvelopeType.envelopeTypeTxV0()) {
      return (innerEnvelope.value() as unknown as xdr.TransactionV0Envelope).tx().operations()
    }
    return (innerEnvelope.value() as xdr.TransactionV1Envelope).tx().operations()
  }

  const v1Envelope = envelope.value() as xdr.TransactionV1Envelope
  return v1Envelope.tx().operations()
}

/**
 * Rebuilds the original transaction after a successful restore.
 * Fetches the latest account sequence number, re-signs with the
 * restored footprint, and re-simulates to assemble the final transaction.
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

  const builder = new TransactionBuilder(account, {
    fee,
    networkPassphrase,
  })

  for (const op of operations) {
    builder.addOperation(op)
  }

  builder.setTimeout(30)
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
