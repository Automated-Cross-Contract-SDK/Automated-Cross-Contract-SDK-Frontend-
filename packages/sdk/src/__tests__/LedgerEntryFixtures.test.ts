import { describe, expect, it } from 'vitest'
import { queryLedgerTTL } from '../TTLHelpers.js'
import type { ISorobanRpcClient } from '../RpcClient.js'
import { ledgerEntryFixture } from '../../../testing/src/fixtures.js'

describe('reusable ledger-entry fixtures', () => {
  it.each([
    { status: 'active', isArchived: false, entryType: 'contractData' },
    { status: 'near-expiry', isArchived: false, entryType: 'contractData' },
    { status: 'archived', isArchived: true, entryType: 'contractData' },
    { status: 'missing', isArchived: true, entryType: 'contractData' },
    { status: 'unsupported', isArchived: false, entryType: 'other' },
  ] as const)(
    '$status fixture produces the expected TTL status',
    async ({ status, isArchived, entryType }) => {
      const fixture = ledgerEntryFixture(status, 7)
      const client = {
        getLedgerEntries: async () => fixture.response,
        getLatestLedger: async () => ({ sequence: fixture.currentLedger }),
      } as unknown as ISorobanRpcClient

      const result = await queryLedgerTTL(client, [fixture.key], {
        currentLedger: fixture.currentLedger,
      })

      expect(result.entries[0]).toMatchObject({ isArchived, entryType })
      expect(fixture.key.toXDR('base64')).toBe(ledgerEntryFixture(status, 7).key.toXDR('base64'))
    },
  )

  it('marks near-expiry entries at the documented fixture window', async () => {
    const fixture = ledgerEntryFixture('near-expiry')
    const client = {
      getLedgerEntries: async () => fixture.response,
      getLatestLedger: async () => ({ sequence: fixture.currentLedger }),
    } as unknown as ISorobanRpcClient

    const result = await queryLedgerTTL(client, [fixture.key], {
      currentLedger: fixture.currentLedger,
    })

    expect(result.entries[0].ttlLedgers).toBe(10)
  })
})
