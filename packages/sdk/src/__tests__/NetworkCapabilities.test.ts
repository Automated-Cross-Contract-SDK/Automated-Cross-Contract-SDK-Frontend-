import { describe, expect, it, vi } from 'vitest'
import { Networks } from '@stellar/stellar-sdk'
import { SorobanResurrect } from '../SorobanResurrect.js'
import type { ISorobanRpcClient } from '../RpcClient.js'
import {
  MIN_RESTORE_PROTOCOL_VERSION,
  checkNetworkCapabilities,
} from '../NetworkCapabilities.js'

function makeClient(overrides: Partial<ISorobanRpcClient> = {}): ISorobanRpcClient {
  return {
    simulateTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
    getAccount: vi.fn(),
    getLedgerEntries: vi.fn(),
    getLatestLedger: vi.fn(),
    getNetwork: vi.fn().mockResolvedValue({ passphrase: Networks.TESTNET }),
    getVersionInfo: vi
      .fn()
      .mockResolvedValue({ version: 'stellar-rpc/23.0.0', protocolVersion: MIN_RESTORE_PROTOCOL_VERSION }),
    ...overrides,
  } as unknown as ISorobanRpcClient
}

describe('checkNetworkCapabilities', () => {
  it('reports compatible endpoint methods, network, and restore protocol', async () => {
    const report = await checkNetworkCapabilities(makeClient(), Networks.TESTNET)

    expect(report.status).toBe('compatible')
    expect(report.isCompatible).toBe(true)
    expect(report.rpcNetworkPassphrase).toBe(Networks.TESTNET)
    expect(report.protocolVersion).toBe(MIN_RESTORE_PROTOCOL_VERSION)
    expect(report.rpcVersion).toBe('stellar-rpc/23.0.0')
    expect(report.requiredRpcMethods.status).toBe('supported')
    expect(report.messages).toEqual([])
  })

  it('reports network and protocol mismatches as incompatible with guidance', async () => {
    const report = await checkNetworkCapabilities(
      makeClient({
        getNetwork: vi.fn().mockResolvedValue({ passphrase: Networks.PUBLIC }),
        getVersionInfo: vi.fn().mockResolvedValue({ protocolVersion: MIN_RESTORE_PROTOCOL_VERSION - 1 }),
      }),
      Networks.TESTNET,
    )

    expect(report.status).toBe('incompatible')
    expect(report.isCompatible).toBe(false)
    expect(report.network.status).toBe('unsupported')
    expect(report.restoreProtocol.status).toBe('unsupported')
    expect(report.messages.join(' ')).toContain('does not match the configured network')
    expect(report.messages.join(' ')).toContain('upgrade or select a compatible network')
  })

  it('reports missing required RPC methods as incompatible', async () => {
    const client = makeClient()
    Object.defineProperty(client, 'getLedgerEntries', { value: undefined })

    const report = await checkNetworkCapabilities(client, Networks.TESTNET)

    expect(report.status).toBe('incompatible')
    expect(report.requiredRpcMethods.missing).toContain('getLedgerEntries')
    expect(report.messages.join(' ')).toContain('getLedgerEntries')
  })

  it('reports omitted metadata probes as unknown, not compatible', async () => {
    const client = makeClient({ getNetwork: undefined, getVersionInfo: undefined })

    const report = await checkNetworkCapabilities(client, Networks.TESTNET)

    expect(report.status).toBe('unknown')
    expect(report.isCompatible).toBeNull()
    expect(report.network.status).toBe('unknown')
    expect(report.restoreProtocol.status).toBe('unknown')
    expect(report.messages.join(' ')).toContain('does not expose getNetwork()')
    expect(report.messages.join(' ')).toContain('does not expose getVersionInfo()')
  })

  it('returns actionable unknown results when metadata RPC calls fail or are malformed', async () => {
    const callFailure = await checkNetworkCapabilities(
      makeClient({
        getNetwork: vi.fn().mockRejectedValue(new Error('connection refused')),
        getVersionInfo: vi.fn().mockResolvedValue({ version: 'unknown' }),
      }),
      Networks.TESTNET,
    )
    const malformedNetwork = await checkNetworkCapabilities(
      makeClient({
        getNetwork: vi.fn().mockResolvedValue({}),
      }),
      Networks.TESTNET,
    )

    expect(callFailure.status).toBe('unknown')
    expect(callFailure.messages.join(' ')).toContain('connection refused')
    expect(callFailure.restoreProtocol.status).toBe('unknown')
    expect(malformedNetwork.network.status).toBe('unknown')
    expect(malformedNetwork.messages.join(' ')).toContain('returned no passphrase')
  })

  it('is exposed on the facade using its current configured client and network', async () => {
    const client = makeClient()
    const sdk = new SorobanResurrect({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: Networks.TESTNET,
      rpcClient: client,
    })
    const report = await sdk.checkNetworkCapabilities()

    expect(report.status).toBe('compatible')
    expect(client.getNetwork).toHaveBeenCalledOnce()
    expect(client.getVersionInfo).toHaveBeenCalledOnce()
  })
})
