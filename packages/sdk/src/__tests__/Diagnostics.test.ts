import { describe, it, expect } from 'vitest'
import { rpc, xdr } from '@stellar/stellar-sdk'
import { parseTransactionDiagnostics } from '../Diagnostics.js'

function diagEvent(topic: string, data: xdr.ScVal): xdr.DiagnosticEvent {
  return new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: xdr.ExtensionPoint.v0(),
      contractId: null,
      type: xdr.ContractEventType.diagnostic,
      body: xdr.ContractEventBody.v0(
        new xdr.ContractEventV0({ topics: [xdr.ScVal.scvSymbol(topic)], data }),
      ),
    }),
  })
}

function txFailed(results: xdr.OperationResult[]): xdr.TransactionResult {
  return new xdr.TransactionResult({
    feeCharged: 100n,
    result: xdr.TransactionResultResult.txFailed(results),
    ext: xdr.TransactionResultExt.v0(),
  })
}

const okInnerOp = xdr.OperationResult.opInner(
  xdr.OperationResultTr.invokeHostFunction(
    xdr.InvokeHostFunctionResult.invokeHostFunctionSuccess(new xdr.Hash(new Uint8Array(32))),
  ),
)
const badAuthOp = xdr.OperationResult.opBadAuth()

const FAILED = rpc.Api.GetTransactionStatus.FAILED
const SUCCESS = rpc.Api.GetTransactionStatus.SUCCESS

describe('parseTransactionDiagnostics (#242)', () => {
  it('returns undefined for a successful transaction', () => {
    expect(parseTransactionDiagnostics({ status: SUCCESS } as never)).toBeUndefined()
  })

  it('returns undefined when there is nothing decodable on a failure', () => {
    expect(parseTransactionDiagnostics({ status: FAILED } as never)).toBeUndefined()
    expect(parseTransactionDiagnostics(null)).toBeUndefined()
  })

  it('parses diagnostic events and derives a revert reason', () => {
    const diag = parseTransactionDiagnostics({
      status: FAILED,
      diagnosticEventsXdr: [
        diagEvent('fn_call', xdr.ScVal.scvString('hello')),
        diagEvent('error', xdr.ScVal.scvString('trapped')),
      ],
    } as never)

    expect(diag).toBeDefined()
    expect(diag!.events).toHaveLength(2)
    expect(diag!.events[0]).toContain('topics=[fn_call]')
    expect(diag!.revertReason).toContain('topics=[error]')
    expect(diag!.rawEventsXdr).toHaveLength(2)
  })

  it('passes through base64 string diagnostic events that cannot be decoded', () => {
    const diag = parseTransactionDiagnostics({
      status: FAILED,
      diagnosticEventsXdr: ['not-real-base64-xdr=='],
    } as never)
    expect(diag!.events).toEqual(['not-real-base64-xdr=='])
    expect(diag!.rawEventsXdr).toEqual(['not-real-base64-xdr=='])
  })

  it('extracts result codes and the failed op index from the result XDR', () => {
    const diag = parseTransactionDiagnostics({
      status: FAILED,
      resultXdr: txFailed([okInnerOp, badAuthOp]),
    } as never)

    expect(diag).toBeDefined()
    expect(diag!.resultCodes).toContain('txFailed')
    expect(diag!.resultCodes).toContain('invokeHostFunctionSuccess')
    expect(diag!.resultCodes).toContain('opBadAuth')
    expect(diag!.failedOpIndex).toBe(1)
  })

  it('combines event and result-xdr diagnostics', () => {
    const diag = parseTransactionDiagnostics({
      status: FAILED,
      diagnosticEventsXdr: [diagEvent('fn_call', xdr.ScVal.scvString('hello'))],
      resultXdr: txFailed([badAuthOp]),
    } as never)

    expect(diag!.events).toHaveLength(1)
    expect(diag!.failedOpIndex).toBe(0)
    expect(diag!.resultCodes).toContain('txFailed')
  })
})
