import { describe, it, expect } from 'vitest'
import { rpc } from '@stellar/stellar-sdk'
import { parseTransactionFailure } from '../TransactionFailure.js'
import {
  INVOKE_TRAPPED_RESULT_XDR,
  INVOKE_ARCHIVED_RESULT_XDR,
  DIAG_FN_CALL_XDR,
  DIAG_ERROR_XDR,
  INSUFFICIENT_FEE_RESULT_XDR,
  OP_NO_ACCOUNT_RESULT_XDR,
} from './fixtures/transactionFailure.js'

const FAILED = rpc.Api.GetTransactionStatus.FAILED

describe('parseTransactionFailure', () => {
  it('returns undefined for non-FAILED responses', () => {
    expect(
      parseTransactionFailure({ status: rpc.Api.GetTransactionStatus.SUCCESS }),
    ).toBeUndefined()
    expect(
      parseTransactionFailure({ status: rpc.Api.GetTransactionStatus.NOT_FOUND }),
    ).toBeUndefined()
  })

  it('accepts the raw string status "FAILED"', () => {
    const parsed = parseTransactionFailure({ status: 'FAILED' })
    expect(parsed).toBeDefined()
    expect(parsed?.txResultCode).toBe('unknown')
  })

  it('decodes a reverted contract call into a readable revert message', () => {
    const parsed = parseTransactionFailure({
      status: FAILED,
      resultXdr: INVOKE_TRAPPED_RESULT_XDR,
      diagnosticEventsXdr: [DIAG_FN_CALL_XDR, DIAG_ERROR_XDR],
    })

    expect(parsed).toBeDefined()
    expect(parsed?.txResultCode).toBe('txFailed')
    expect(parsed?.failedOperationIndex).toBe(0)
    expect(parsed?.operationResultCode).toBe('invokeHostFunctionTrapped')
    expect(parsed?.contractError).toBe('Error(Contract, #3)')
    expect(parsed?.message).toContain('require_auth')
    expect(parsed?.message).toContain('Error(Contract, #3)')
    expect(parsed?.diagnosticMessages.some((m) => m.includes('transfer(from, to, amount)'))).toBe(
      true,
    )
  })

  it('identifies the failed operation and code without diagnostics', () => {
    const parsed = parseTransactionFailure({
      status: FAILED,
      resultXdr: INVOKE_ARCHIVED_RESULT_XDR,
    })

    expect(parsed?.txResultCode).toBe('txFailed')
    expect(parsed?.failedOperationIndex).toBe(0)
    expect(parsed?.operationResultCode).toBe('invokeHostFunctionEntryArchived')
    expect(parsed?.contractError).toBeUndefined()
    expect(parsed?.message).toBe(
      'Transaction failed on-chain: invokeHostFunctionEntryArchived (operation 0)',
    )
  })

  it('handles a top-level result code with no per-operation results', () => {
    const parsed = parseTransactionFailure({
      status: FAILED,
      resultXdr: INSUFFICIENT_FEE_RESULT_XDR,
    })

    expect(parsed?.txResultCode).toBe('txInsufficientFee')
    expect(parsed?.failedOperationIndex).toBeUndefined()
    expect(parsed?.operationResultCode).toBeUndefined()
    expect(parsed?.message).toBe('Transaction failed on-chain: txInsufficientFee')
  })

  it('decodes an operation rejected before inner execution', () => {
    const parsed = parseTransactionFailure({
      status: FAILED,
      resultXdr: OP_NO_ACCOUNT_RESULT_XDR,
    })

    expect(parsed?.txResultCode).toBe('txFailed')
    expect(parsed?.failedOperationIndex).toBe(0)
    expect(parsed?.operationResultCode).toBe('opNoAccount')
  })

  it('degrades gracefully when the result XDR cannot be decoded', () => {
    const parsed = parseTransactionFailure({
      status: FAILED,
      resultXdr: 'not-valid-base64-xdr!!!',
      diagnosticEventsXdr: ['also-garbage'],
    })

    expect(parsed).toBeDefined()
    expect(parsed?.txResultCode).toBe('unknown')
    expect(parsed?.diagnosticMessages).toEqual([])
    expect(parsed?.message).toBe('Transaction failed on-chain')
  })

  it('still surfaces diagnostics when only events are available', () => {
    const parsed = parseTransactionFailure({
      status: FAILED,
      diagnosticEventsXdr: [DIAG_ERROR_XDR],
    })

    expect(parsed?.txResultCode).toBe('unknown')
    expect(parsed?.contractError).toBe('Error(Contract, #3)')
    expect(parsed?.message).toContain('require_auth')
  })
})
