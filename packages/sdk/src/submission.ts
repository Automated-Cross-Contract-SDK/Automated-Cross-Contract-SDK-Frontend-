import { rpc, type Transaction } from '@stellar/stellar-sdk'
import { archivedKeysInResources, extractAutoRestoredKeys } from './Archiver.js'
import { ResurrectError, type ResurrectErrorCode } from './errors.js'

/**
 * Throws unless the RPC accepted the transaction. `sendTransaction` reports a
 * rejection through `status` rather than by throwing, and a rejected
 * transaction never reaches a ledger, so polling for it only times out.
 */
export function assertSubmitted(
  response: rpc.Api.SendTransactionResponse,
  code: ResurrectErrorCode,
  label: string,
): void {
  if (response.status !== 'ERROR' && response.status !== 'TRY_AGAIN_LATER') return
  const reason = response.errorResult?.result?.type ?? response.status
  throw new ResurrectError(code, `${label} was rejected by the network: ${reason}`)
}

/** Resource fee already declared by an assembled Soroban transaction, else 0. */
export function declaredResourceFee(transaction: Transaction): bigint {
  const envelope = transaction.toEnvelope()
  if (envelope.type !== 'envelopeTypeTx') return 0n
  const { ext } = envelope.v1.tx
  return 'sorobanData' in ext ? ext.sorobanData.resourceFee : 0n
}

const SOROBAN_OPERATIONS = ['invokeHostFunction', 'extendFootprintTtl', 'restoreFootprint']

/**
 * Applies the simulated footprint, resource fee and authorization to a
 * transaction that has not been assembled yet. Transactions the caller already
 * assembled are returned untouched unless they miss a newly archived entry.
 */
export function assembleIfNeeded(
  transaction: Transaction,
  simulation: rpc.Api.SimulateTransactionSuccessResponse,
): Transaction {
  const envelope = transaction.toEnvelope()
  if (
    transaction.operations.length !== 1 ||
    !SOROBAN_OPERATIONS.includes(transaction.operations[0].type) ||
    envelope.type !== 'envelopeTypeTx'
  ) {
    return transaction
  }
  const { ext } = envelope.v1.tx
  if ('sorobanData' in ext) {
    // Entries may have been archived since the caller assembled it.
    const declared = new Set(archivedKeysInResources(ext.sorobanData).map((e) => e.keyBase64))
    const upToDate = extractAutoRestoredKeys(simulation).every((e) => declared.has(e.keyBase64))
    if (upToDate) return transaction
  }
  return rpc.assembleTransaction(transaction, simulation).build()
}
