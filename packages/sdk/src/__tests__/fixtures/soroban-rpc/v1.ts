import { SorobanDataBuilder, xdr } from '@stellar/stellar-sdk'

const sorobanData = new SorobanDataBuilder().build()
const archivedKey = { toXDR: () => 'AAAA' }

function transactionData(readWrite: unknown[] = []) {
  return {
    build: () => sorobanData,
    getFootprint: () => ({
      readOnly: () => [],
      readWrite: () => readWrite,
    }),
  }
}

export const sorobanRpcResponseFixturesV1 = {
  success: {
    id: 'fixture-success-v1',
    latestLedger: 100,
    events: [],
    diagnosticEvents: [],
    _parsed: true,
    transactionData: transactionData(),
    minResourceFee: '100',
    cost: { cpuInsns: '100', memBytes: '100' },
    result: { auth: [], retval: xdr.ScVal.scvVoid() },
  },
  restore: {
    id: 'fixture-restore-v1',
    latestLedger: 100,
    events: [],
    _parsed: true,
    transactionData: transactionData([archivedKey]),
    minResourceFee: '100',
    cost: { cpuInsns: '100', memBytes: '100' },
    result: { auth: [], retval: xdr.ScVal.scvVoid() },
    restorePreamble: {
      minResourceFee: '100',
      transactionData: { build: () => sorobanData },
    },
  },
  error: {
    id: 'fixture-error-v1',
    latestLedger: 100,
    events: [],
    _parsed: true,
    error: 'fixture simulation error',
  },
  malformed: {
    id: 'fixture-malformed-v1',
    latestLedger: 100,
    events: [],
    _parsed: true,
  },
  extendedSuccess: {
    id: 'fixture-extended-success-v1',
    latestLedger: 101,
    events: [],
    diagnosticEvents: [],
    _parsed: true,
    transactionData: transactionData(),
    minResourceFee: '125',
    cost: { cpuInsns: '150', memBytes: '200' },
    result: { auth: [], retval: xdr.ScVal.scvVoid() },
    // Additional response fields must not break existing success handling.
    latestLedgerCloseTime: '2026-10-15T17:00:00Z',
  },
} as const
