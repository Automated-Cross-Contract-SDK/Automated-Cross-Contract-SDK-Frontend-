import { describe, expect, it } from 'vitest'
import { Address, Keypair, xdr } from '@stellar/stellar-sdk'
import { serializeLedgerKey } from '../LedgerKey.js'

function contractDataKey(): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.contract(Buffer.alloc(32, 1)).toScAddress(),
      key: xdr.ScVal.scvSymbol('balance'),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  )
}

describe('serializeLedgerKey', () => {
  it('returns canonical base64 XDR for contract-data and contract-code keys', () => {
    const keys = [
      contractDataKey(),
      xdr.LedgerKey.contractCode(
        new xdr.LedgerKeyContractCode({ hash: Buffer.alloc(32, 2) }),
      ),
    ]

    for (const key of keys) {
      const serialized = serializeLedgerKey(key)
      expect(serialized).toBe(key.toXDR('base64'))
      expect(xdr.LedgerKey.fromXDR(serialized, 'base64').toXDR('base64')).toBe(serialized)
    }
  })

  it('is deterministic for equivalent decoded keys and distinguishes different keys', () => {
    const key = xdr.LedgerKey.account(
      new xdr.LedgerKeyAccount({ accountId: Keypair.random().xdrPublicKey() }),
    )
    const serialized = serializeLedgerKey(key)
    const decoded = xdr.LedgerKey.fromXDR(serialized, 'base64')

    expect(serializeLedgerKey(decoded)).toBe(serialized)
    expect(serializeLedgerKey(contractDataKey())).not.toBe(serialized)
  })
})
