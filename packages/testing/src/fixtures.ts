import { Account, Keypair, SorobanDataBuilder, rpc, xdr } from '@stellar/stellar-sdk'

/**
 * Canned Soroban RPC responses for every step of the restore flow:
 * detect (simulate), restore (simulate-restore + send + confirm) and resubmit.
 *
 * Responses are shaped like the parsed objects `rpc.Server` returns, so they
 * satisfy the `rpc.Api.isSimulation*` guards the SDK relies on.
 */

const LATEST_LEDGER = 1000

function sorobanData(readWrite: xdr.LedgerKey[] = []): SorobanDataBuilder {
  return new SorobanDataBuilder().setFootprint([], readWrite)
}

/** A contract-data ledger key usable as a stand-in archived entry. */
export function archivedKey(seed = 0): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: xdr.ScAddress.scAddressTypeAccount(Keypair.random().xdrAccountId()),
      key: xdr.ScVal.scvU32(seed),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  )
}

/** Simulation succeeded; no archived entries in the footprint. */
export function simulateSuccess(latestLedger = LATEST_LEDGER) {
  return {
    id: 'sim-success',
    latestLedger,
    events: [],
    _parsed: true,
    transactionData: sorobanData(),
    minResourceFee: '100',
    cost: { cpuInsns: '100', memBytes: '100' },
    result: { auth: [], retval: xdr.ScVal.scvVoid() },
  } as unknown as rpc.Api.SimulateTransactionSuccessResponse
}

/** Simulation found archived entries and returned a restore preamble. */
export function simulateRestore(
  keys: xdr.LedgerKey[] = [archivedKey()],
  latestLedger = LATEST_LEDGER,
) {
  return {
    ...simulateSuccess(latestLedger),
    id: 'sim-restore',
    transactionData: sorobanData(keys),
    restorePreamble: {
      minResourceFee: '1000',
      transactionData: sorobanData(keys),
    },
  } as unknown as rpc.Api.SimulateTransactionRestoreResponse
}

/** Simulation failed (e.g. a contract panic or an invalid restore footprint). */
export function simulateError(
  error = 'HostError: Error(Contract, #1)',
  latestLedger = LATEST_LEDGER,
) {
  return {
    id: 'sim-error',
    latestLedger,
    events: [],
    _parsed: true,
    error,
  } as unknown as rpc.Api.SimulateTransactionErrorResponse
}

/** `sendTransaction` accepted the envelope. */
export function sendPending(hash = 'mock-tx-hash', latestLedger = LATEST_LEDGER) {
  return {
    status: 'PENDING',
    hash,
    latestLedger,
    latestLedgerCloseTime: 0,
  } as unknown as rpc.Api.SendTransactionResponse
}

/** `sendTransaction` rejected the envelope with a transaction result code. */
export function sendError(
  code: 'txBadSeq' | 'txInsufficientFee' | 'txFailed' = 'txBadSeq',
  hash = 'mock-tx-hash',
) {
  const result =
    code === 'txFailed'
      ? xdr.TransactionResultResult.txFailed([] as xdr.OperationResult[])
      : xdr.TransactionResultResult[code]()
  return {
    status: 'ERROR',
    hash,
    latestLedger: LATEST_LEDGER,
    latestLedgerCloseTime: 0,
    errorResult: new xdr.TransactionResult({
      feeCharged: xdr.Int64.fromString('100'),
      result,
      ext: xdr.TransactionResultExt[0](),
    }),
  } as unknown as rpc.Api.SendTransactionResponse
}

/** `getTransaction` reports the transaction confirmed. */
export function txSuccess(latestLedger = LATEST_LEDGER + 5) {
  return {
    status: rpc.Api.GetTransactionStatus.SUCCESS,
    latestLedger,
    ledger: latestLedger,
  } as unknown as rpc.Api.GetTransactionResponse
}

/** `getTransaction` reports the transaction failed on-chain. */
export function txFailed(latestLedger = LATEST_LEDGER + 5) {
  return {
    status: rpc.Api.GetTransactionStatus.FAILED,
    latestLedger,
    ledger: latestLedger,
  } as unknown as rpc.Api.GetTransactionResponse
}

/** `getTransaction` has not seen the transaction yet (keeps the poller waiting). */
export function txNotFound(latestLedger = LATEST_LEDGER) {
  return {
    status: rpc.Api.GetTransactionStatus.NOT_FOUND,
    latestLedger,
  } as unknown as rpc.Api.GetTransactionResponse
}

/** A funded-looking account with a deterministic sequence number. */
export function account(publicKey = Keypair.random().publicKey(), sequence = '100'): Account {
  return new Account(publicKey, sequence)
}
