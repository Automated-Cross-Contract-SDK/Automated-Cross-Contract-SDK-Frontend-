import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SorobanResurrect } from '../SorobanResurrect.js'
import {
  TransactionBuilder,
  Account,
  Networks,
  Operation,
  Keypair,
  Transaction,
  SorobanDataBuilder,
} from '@stellar/stellar-sdk'
import type { SorobanResurrectConfig, WalletAdapter } from '../types.js'
import { executeWithRestore } from '../Executor.js'

vi.mock('../Executor.js', () => ({
  executeWithRestore: vi.fn(),
}))

const testConfig: SorobanResurrectConfig = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
}

function makeSampleTx(): Transaction {
  const kp = Keypair.random()
  const account = new Account(kp.publicKey(), '1')
  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setTimeout(30)
    .build()
}

function makeWallet(): WalletAdapter {
  return {
    isConnected: vi.fn().mockResolvedValue(true),
    getPublicKey: vi.fn().mockResolvedValue(Keypair.random().publicKey()),
    signTransaction: vi.fn().mockImplementation(async (tx: string) => tx),
  }
}

describe('SorobanResurrect', () => {
  let resurrect: SorobanResurrect

  beforeEach(() => {
    vi.clearAllMocks()
    resurrect = new SorobanResurrect(testConfig)
  })

  describe('constructor', () => {
    it('creates an instance with resolved config', () => {
      expect(resurrect).toBeInstanceOf(SorobanResurrect)
      expect(resurrect.config.rpcUrl).toBe(testConfig.rpcUrl)
      expect(resurrect.config.networkPassphrase).toBe(Networks.TESTNET)
    })

    it('uses defaults for optional config values', () => {
      expect(resurrect.config.pollIntervalMs).toBe(1000)
      expect(resurrect.config.pollTimeoutMs).toBe(60000)
    })

    it('creates an rpc.Server with the given URL', () => {
      expect(resurrect.server).toBeDefined()
    })
  })

  describe('state management', () => {
    it('starts in idle state', () => {
      expect(resurrect.state).toBe('idle')
    })

    it('returns stateInfo with current state', () => {
      const info = resurrect.stateInfo
      expect(info.state).toBe('idle')
      expect(info.message).toBe('')
    })

    it('notifies listeners on state change', () => {
      const listener = vi.fn()
      resurrect.onStateChange(listener)
      resurrect.detectArchivedKeys(makeSampleTx()).catch(() => {})
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ state: expect.any(String) }))
    })

    it('supports unsubscribing listeners', () => {
      const listener = vi.fn()
      const unsubscribe = resurrect.onStateChange(listener)
      unsubscribe()
      resurrect.detectArchivedKeys(makeSampleTx()).catch(() => {})
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('submitWithRestore', () => {
    it('returns result from executeWithRestore on success', async () => {
      const mockResult = {
        success: true,
        originalTxHash: 'orig-hash',
        archivedKeysDetected: 0,
      }
      vi.mocked(executeWithRestore).mockImplementation(async (params) => {
        // Simulate the callback that sets success state
        params.onOriginalSubmitted?.('orig-hash')
        return mockResult
      })

      const result = await resurrect.submitWithRestore({
        transaction: makeSampleTx(),
        wallet: makeWallet(),
      })

      expect(result).toEqual(mockResult)
      expect(resurrect.state).toBe('success')
    })

    it('sets error state when execution fails', async () => {
      vi.mocked(executeWithRestore).mockResolvedValue({
        success: false,
        archivedKeysDetected: 0,
        error: 'something went wrong',
      })

      const result = await resurrect.submitWithRestore({
        transaction: makeSampleTx(),
        wallet: makeWallet(),
      })

      expect(result.success).toBe(false)
      expect(resurrect.state).toBe('error')
      expect(resurrect.stateInfo.error).toBe('something went wrong')
    })

    it('forwards callbacks to executeWithRestore', async () => {
      vi.mocked(executeWithRestore).mockResolvedValue({
        success: true,
        archivedKeysDetected: 0,
      })

      const onRestoreNeeded = vi.fn()
      const onOriginalSubmitted = vi.fn()

      await resurrect.submitWithRestore({
        transaction: makeSampleTx(),
        wallet: makeWallet(),
        onRestoreNeeded,
        onOriginalSubmitted,
      })

      expect(executeWithRestore).toHaveBeenCalledWith(
        expect.objectContaining({
          onRestoreNeeded: expect.any(Function),
          onOriginalSubmitted: expect.any(Function),
        }),
      )
    })
  })

  describe('detectArchivedKeys', () => {
    it('returns empty array and updates state when simulation succeeds', async () => {
      vi.spyOn(resurrect.server, 'simulateTransaction').mockResolvedValue({
        id: '1',
        latestLedger: 100,
        events: [],
        _parsed: true,
        transactionData: {
          build: () => ({}),
          getFootprint: () => ({ readOnly: () => [], readWrite: () => [] }),
        },
        minResourceFee: '100',
        cost: { cpuInsns: '100', memBytes: '100' },
        result: { auth: [], retval: { switch: () => 0 } },
      } as never)

      const keys = await resurrect.detectArchivedKeys(makeSampleTx())
      expect(keys).toEqual([])
    })
  })

  describe('needsRestore', () => {
    it('returns false when no archived keys', async () => {
      vi.spyOn(resurrect.server, 'simulateTransaction').mockResolvedValue({
        id: '1',
        latestLedger: 100,
        events: [],
        _parsed: true,
        transactionData: {
          build: () => ({}),
          getFootprint: () => ({ readOnly: () => [], readWrite: () => [] }),
        },
        minResourceFee: '100',
        cost: { cpuInsns: '100', memBytes: '100' },
        result: { auth: [], retval: { switch: () => 0 } },
      } as never)

      const needed = await resurrect.needsRestore(makeSampleTx())
      expect(needed).toBe(false)
    })
  })

  describe('buildRestoreTx', () => {
    it('throws when no restore is needed', async () => {
      vi.spyOn(resurrect.server, 'simulateTransaction').mockResolvedValue({
        id: '1',
        latestLedger: 100,
        events: [],
        _parsed: true,
        error: 'some error',
      } as never)

      await expect(
        resurrect.buildRestoreTx(Keypair.random().publicKey(), makeSampleTx()),
      ).rejects.toThrow('No archived keys detected')
    })

    it('accepts optional simulationResponse to avoid state side-effects', async () => {
      const mockKey = { toXDR: () => 'base64-key' }
      const mockSorobanData = new SorobanDataBuilder().build()
      const mockRestoreResponse = {
        id: '1',
        latestLedger: 100,
        events: [],
        _parsed: true,
        transactionData: {
          build: () => mockSorobanData,
          getFootprint: () => ({ readOnly: () => [], readWrite: () => [mockKey] }),
        },
        minResourceFee: '100',
        cost: { cpuInsns: '100', memBytes: '100' },
        result: { auth: [], retval: { switch: () => 0 } },
        restorePreamble: {
          minResourceFee: '100',
          transactionData: { build: () => mockSorobanData },
        },
      }

      vi.spyOn(resurrect.server, 'getAccount').mockResolvedValue(
        new Account(Keypair.random().publicKey(), '2') as never,
      )

      const initialState = resurrect.state
      await resurrect.buildRestoreTx(Keypair.random().publicKey(), makeSampleTx(), mockRestoreResponse as never)
      
      // When providing simulationResponse, state should not change to 'simulating'
      expect(resurrect.state).toBe(initialState)
    })
  })

  describe('config option: networkPassphrase validation', () => {
    it('accepts known network passphrases', () => {
      const testnet = new SorobanResurrect({ ...testConfig, networkPassphrase: Networks.TESTNET })
      expect(testnet.config.networkPassphrase).toBe(Networks.TESTNET)

      const mainnet = new SorobanResurrect({ ...testConfig, networkPassphrase: Networks.PUBLIC })
      expect(mainnet.config.networkPassphrase).toBe(Networks.PUBLIC)

      const futurenet = new SorobanResurrect({ ...testConfig, networkPassphrase: Networks.FUTURENET })
      expect(futurenet.config.networkPassphrase).toBe(Networks.FUTURENET)
    })

    it('throws on invalid network passphrase', () => {
      expect(() => {
        new SorobanResurrect({
          ...testConfig,
          networkPassphrase: 'Invalid Network ; September 2015',
        })
      }).toThrow(/Invalid network passphrase/)
    })

    it('throws on typo in network passphrase', () => {
      expect(() => {
        new SorobanResurrect({
          ...testConfig,
          networkPassphrase: 'Test SDF Network ; September 2016', // typo: 2016 instead of 2015
        })
      }).toThrow(/Invalid network passphrase/)
    })

    it('uses Testnet by default when no passphrase provided', () => {
      const r = new SorobanResurrect({ rpcUrl: 'https://soroban-testnet.stellar.org' })
      expect(r.config.networkPassphrase).toBe(Networks.TESTNET)
    })
  })

  describe('config option: restoreFeeMultiplier', () => {
    it('defaults to 3', () => {
      const r = new SorobanResurrect(testConfig)
      expect(r.config.restoreFeeMultiplier).toBe(3)
    })

    it('accepts custom restoreFeeMultiplier', () => {
      const r = new SorobanResurrect({
        ...testConfig,
        restoreFeeMultiplier: 50,
      })
      expect(r.config.restoreFeeMultiplier).toBe(50)
    })
  })

  describe('config option: archiveDetectionMethod', () => {
    it('defaults to simulation', () => {
      const r = new SorobanResurrect(testConfig)
      expect(r.config.archiveDetectionMethod).toBe('simulation')
    })

    it('accepts direct detection method', () => {
      const r = new SorobanResurrect({
        ...testConfig,
        archiveDetectionMethod: 'direct',
      })
      expect(r.config.archiveDetectionMethod).toBe('direct')
    })
  })
})
