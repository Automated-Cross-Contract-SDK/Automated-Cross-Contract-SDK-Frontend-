import type { ResurrectErrorCode } from './errors.js'
import type { ResurrectFailure, ResurrectFailureStage } from './types.js'

type Guidance = Omit<ResurrectFailure, 'code'>

const guidance: Record<ResurrectErrorCode, Guidance> = {
  WALLET_NOT_CONNECTED: {
    stage: 'signing',
    retryable: true,
    nextStep: 'Connect the wallet, then review and retry the transaction.',
  },
  SIMULATION_FAILED: {
    stage: 'simulation',
    retryable: false,
    nextStep: 'Review the transaction and RPC availability before trying again.',
  },
  RESTORE_TX_PARSE_FAILED: {
    stage: 'signing',
    retryable: false,
    nextStep: 'Check the wallet network and signed transaction response.',
  },
  RESTORE_TX_FAILED: {
    stage: 'confirmation',
    retryable: false,
    nextStep: 'Inspect the restore transaction on-chain before retrying.',
  },
  ORIGINAL_TX_PARSE_FAILED: {
    stage: 'signing',
    retryable: false,
    nextStep: 'Check the wallet network and signed transaction response.',
  },
  ORIGINAL_TX_FAILED: {
    stage: 'confirmation',
    retryable: false,
    nextStep: 'Review the transaction result and create a fresh transaction if needed.',
  },
  ORIGINAL_TRANSACTION_EXPIRED: {
    stage: 'rebuild',
    retryable: false,
    nextStep: 'Ask the user to approve replacement time bounds before rebuilding.',
  },
  INVALID_REBUILD_TIME_BOUNDS: {
    stage: 'rebuild',
    retryable: false,
    nextStep: 'Provide valid future replacement time bounds and request explicit approval.',
  },
  UNEXPECTED_SIMULATION_RESPONSE: {
    stage: 'simulation',
    retryable: false,
    nextStep: 'Check RPC compatibility and report the unexpected response.',
  },
  UNSUPPORTED_WALLET_CAPABILITY: {
    stage: 'signing',
    retryable: false,
    nextStep: 'Use a wallet that supports the required transaction operation.',
  },
  UNKNOWN_ERROR: {
    stage: 'unknown',
    retryable: false,
    nextStep: 'Review the error and transaction state before deciding whether to retry.',
  },
  RESTORE_FEE_CAP_EXCEEDED: {
    stage: 'restore',
    retryable: false,
    nextStep: 'Review the restore fee cap or wait for lower network fees.',
  },
  INVALID_RESTORE_KEYS: {
    stage: 'restore',
    retryable: false,
    nextStep: 'Provide at least one valid ledger key to restore.',
  },
  CONFIRMATION_TIMEOUT: {
    stage: 'confirmation',
    retryable: true,
    nextStep: 'Check the transaction hash on-chain; it may still confirm before you retry.',
  },
  INCOMPLETE_FOOTPRINT: {
    stage: 'simulation',
    retryable: false,
    nextStep: 'Re-simulate the transaction; the RPC returned an unusable restore footprint.',
  },
  INVALID_RESTORE_MEMO: {
    stage: 'restore',
    retryable: false,
    nextStep: 'Fix the configured restore memo, then retry.',
  },
  BATCH_SIZE_EXCEEDED: {
    stage: 'restore',
    retryable: false,
    nextStep: 'Split the request into smaller batches and retry.',
  },
  UNEXPECTED_FEE_BUMP_ENVELOPE: {
    stage: 'signing',
    retryable: false,
    nextStep: 'Make sure the wallet returns a plain signed transaction, not a fee-bump envelope.',
  },
  SIGNED_TRANSACTION_MISMATCH: {
    stage: 'signing',
    retryable: false,
    nextStep: 'The wallet changed the transaction while signing; review it and sign again.',
  },
  ARCHIVE_DETECTION_BATCH_FAILED: {
    stage: 'simulation',
    retryable: true,
    nextStep: 'Check RPC availability and retry archive detection.',
  },
  RPC_TIMEOUT: {
    stage: 'unknown',
    retryable: true,
    nextStep: 'The RPC endpoint was slow to respond; retry or use a different RPC endpoint.',
  },
  NETWORK_ERROR: {
    stage: 'unknown',
    retryable: true,
    nextStep: 'Check network connectivity and RPC availability, then retry.',
  },
  ABORTED: {
    stage: 'unknown',
    retryable: true,
    nextStep: 'Check any submitted transaction hash before starting the workflow again.',
  },
}

/** Returns stable, safe recovery guidance for a public SDK error code. */
export function createFailureGuidance(
  code: ResurrectErrorCode,
  stage?: ResurrectFailureStage,
): ResurrectFailure {
  return { ...guidance[code], ...(stage ? { stage } : {}), code }
}
