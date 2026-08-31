import { describe, it, expect, vi } from 'vitest'
import {
  Account,
  Address,
  Keypair,
  Networks,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk'
import {
  ensureAddressAuthorization,
  supportsAuthEntrySigning,
  requiresAddressAuthorization,
  type AuthorizationWalletAdapter,
} from '../Authorization.js'

const NP = Networks.TESTNET
const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7))

function contractScAddress(): xdr.ScAddress {
  return new Address(CONTRACT_ID).toScAddress()
}

function makeRootInvocation(): xdr.SorobanAuthorizedInvocation {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: contractScAddress(),
        functionName: 'transfer',
        args: [],
      }),
    ),
    subInvocations: [],
  })
}

function makeAddressAuthEntry(signerPk: string): xdr.SorobanAuthorizationEntry {
  const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(
    new xdr.SorobanAddressCredentials({
      address: new Address(signerPk).toScAddress(),
      nonce: xdr.Int64.fromString('987654321'),
      signatureExpirationLedger: 123456,
      signature: xdr.ScVal.scvVoid(),
    }),
  )
  return new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation: makeRootInvocation() })
}

function makeSourceAccountAuthEntry(): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: makeRootInvocation(),
  })
}

function makeInvokeTx(sourcePk: string): Transaction {
  const op = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: contractScAddress(),
        functionName: 'transfer',
        args: [],
      }),
    ),
    auth: [],
  })
  return new TransactionBuilder(new Account(sourcePk, '1'), { fee: '100', networkPassphrase: NP })
    .addOperation(op)
    .setTimeout(30)
    .build()
}

describe('supportsAuthEntrySigning', () => {
  it('detects wallets that implement signAuthEntry', () => {
    expect(supportsAuthEntrySigning({ signAuthEntry: () => {} })).toBe(true)
    expect(supportsAuthEntrySigning({})).toBe(false)
    expect(supportsAuthEntrySigning(null)).toBe(false)
    expect(supportsAuthEntrySigning({ signTransaction: () => {} })).toBe(false)
  })
})

describe('ensureAddressAuthorization (#244)', () => {
  const signerKp = Keypair.random()
  const sourceKp = Keypair.random()

  it('passes the transaction through untouched when there are no address-auth entries', async () => {
    const tx = makeInvokeTx(sourceKp.publicKey())
    const res = await ensureAddressAuthorization({
      transaction: tx,
      simulation: { result: { auth: [makeSourceAccountAuthEntry()] } },
      wallet: { signTransaction: vi.fn() },
      networkPassphrase: NP,
    })
    expect(res.signed).toBe(false)
    expect(res.signedEntryCount).toBe(0)
    expect(res.transaction).toBe(tx)
  })

  it('returns a clear, actionable error when address-auth is required but the wallet cannot sign it', async () => {
    const tx = makeInvokeTx(sourceKp.publicKey())
    await expect(
      ensureAddressAuthorization({
        transaction: tx,
        simulation: { result: { auth: [makeAddressAuthEntry(signerKp.publicKey())] } },
        wallet: { signTransaction: vi.fn() },
        networkPassphrase: NP,
      }),
    ).rejects.toThrow(/address-based authorization signature\(s\) \(CAP-0046.*signAuthEntry\(\)/s)
  })

  it('signs address-auth entries with the wallet and attaches them to the tx', async () => {
    const tx = makeInvokeTx(sourceKp.publicKey())
    const entry = makeAddressAuthEntry(signerKp.publicKey())

    // Wallet "signs" by echoing the entry back (a valid SorobanAuthorizationEntry XDR).
    const signAuthEntry = vi.fn(async (entryXdr: string) => entryXdr)
    const wallet = { signAuthEntry } as unknown as AuthorizationWalletAdapter

    const res = await ensureAddressAuthorization({
      transaction: tx,
      simulation: { result: { auth: [entry] } },
      wallet,
      networkPassphrase: NP,
    })

    expect(signAuthEntry).toHaveBeenCalledTimes(1)
    expect((signAuthEntry.mock.calls[0] as unknown[])[1]).toMatchObject({ networkPassphrase: NP })
    expect(res.signed).toBe(true)
    expect(res.signedEntryCount).toBe(1)

    // The rebuilt tx carries the auth entry on its InvokeHostFunction op.
    const rebuiltOp = res.transaction.operations[0] as { auth?: unknown[] }
    expect(rebuiltOp.auth).toHaveLength(1)
    // And it round-trips through XDR.
    const reparsed = TransactionBuilder.fromXDR(res.transaction.toXDR(), NP) as Transaction
    expect((reparsed.operations[0] as { auth?: unknown[] }).auth).toHaveLength(1)
  })

  it('requiresAddressAuthorization agrees with the entry credential types', () => {
    expect(requiresAddressAuthorization([makeSourceAccountAuthEntry()])).toBe(false)
    expect(requiresAddressAuthorization([makeAddressAuthEntry(signerKp.publicKey())])).toBe(true)
  })
})
