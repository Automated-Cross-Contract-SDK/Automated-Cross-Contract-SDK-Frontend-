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
}

/** Returns stable, safe recovery guidance for a public SDK error code. */
export function createFailureGuidance(
  code: ResurrectErrorCode,
  stage?: ResurrectFailureStage,
): ResurrectFailure {
  return { ...guidance[code], ...(stage ? { stage } : {}), code }
}
