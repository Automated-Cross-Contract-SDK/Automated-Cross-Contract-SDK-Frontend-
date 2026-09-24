import { describe, it, expect } from 'vitest'
import { rpc } from '@stellar/stellar-sdk'
import { parseTransactionDiagnostics } from '../Diagnostics.js'

/**
 * Duck-typed stand-ins for the XDR object graph the parser walks. The real
 * `xdr.DiagnosticEvent` / `xdr.TransactionResult` decoders are exercised
 * transitively; here we pin the parsing / extraction logic against fixtures.
 */
function fakeDiagEvent(topicName: string, dataName: string) {
  return {
    toXDR: () => `xdr(${topicName}/${dataName})`,
    inSuccessfulContractCall: () => false,
    event: () => ({
      body: () => ({
        v0: () => ({
          topics: () => [{ switch: () => ({ name: topicName }) }],
          data: () => ({ switch: () => ({ name: dataName }) }),
        }),
      }),
    }),
  }
}

function fakeResult(txCode: string, opResults: unknown[]) {
  return {
    result: () => ({
      switch: () => ({ name: txCode }),
      results: () => opResults,
    }),
  }
}

const okInnerOp = {
  switch: () => ({ name: 'opInner' }),
  tr: () => ({
    switch: () => ({ name: 'invokeHostFunction' }),
    invokeHostFunctionResult: () => ({ switch: () => ({ name: 'invokeHostFunctionSuccess' }) }),
  }),
}
const badAuthOp = { switch: () => ({ name: 'opBadAuth' }) }

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
        fakeDiagEvent('scvSymbol', 'scvString'),
        fakeDiagEvent('scvSymbol', 'scvError'),
      ],
    } as never)

    expect(diag).toBeDefined()
    expect(diag!.events).toHaveLength(2)
    expect(diag!.events[0]).toContain('topics=[scvSymbol]')
    expect(diag!.revertReason).toContain('scvError')
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
      resultXdr: fakeResult('txFailed', [okInnerOp, badAuthOp]),
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
      diagnosticEventsXdr: [fakeDiagEvent('scvSymbol', 'scvString')],
      resultXdr: fakeResult('txFailed', [badAuthOp]),
    } as never)

    expect(diag!.events).toHaveLength(1)
    expect(diag!.failedOpIndex).toBe(0)
    expect(diag!.resultCodes).toContain('txFailed')
  })
})
