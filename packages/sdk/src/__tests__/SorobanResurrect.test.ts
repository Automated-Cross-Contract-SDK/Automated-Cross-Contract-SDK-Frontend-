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
import { asTxHash } from '../branded-types.js'

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

  describe('switchNetwork', () => {
    it('creates a new RPC client when changing the URL from an injected client', () => {
      const injectedClient = {
        simulateTransaction: vi.fn(),
        getAccount: vi.fn(),
        sendTransaction: vi.fn(),
        getTransaction: vi.fn(),
        getLedgerEntries: vi.fn(),
      }
      const instance = new SorobanResurrect({
        ...testConfig,
        rpcClient: injectedClient as never,
      })

      instance.switchNetwork({
        rpcUrl: 'https://soroban-mainnet.stellar.org',
        networkPassphrase: Networks.PUBLIC,
      })

      expect(instance.server).not.toBe(injectedClient)
      expect(instance.config.rpcUrl).toBe('https://soroban-mainnet.stellar.org')
      expect(instance.config.rpcClient).toBe(instance.server)
    })

    it('rejects switching during a workflow', async () => {
      let resolveSimulation!: (value: never) => void
      vi.spyOn(resurrect.server, 'simulateTransaction').mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSimulation = resolve
          }) as never,
      )

      const detection = resurrect.detectArchivedKeys(makeSampleTx())
      expect(resurrect.state).toBe('simulating')
      expect(() => resurrect.switchNetwork('mainnet')).toThrow(
        'Cannot switch networks while an SDK operation or TTL watch cycle is in progress',
      )

      resolveSimulation({} as never)
      await detection
    })

    it('keeps a workflow bound to its endpoint until it settles', async () => {
      let finishWorkflow!: (value: never) => void
      vi.mocked(executeWithRestore).mockImplementation(
        () =>
          new Promise((resolve) => {
            finishWorkflow = resolve
          }),
      )

      const workflow = resurrect.submitWithRestore({
        transaction: makeSampleTx(),
        wallet: makeWallet(),
      })
      expect(() => resurrect.switchNetwork('mainnet')).toThrow(
        'Cannot switch networks while an SDK operation or TTL watch cycle is in progress',
      )

      finishWorkflow({ success: false, archivedKeysDetected: 0 } as never)
      await workflow
      expect(() => resurrect.switchNetwork('mainnet')).not.toThrow()
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
    it('cancels active workflows through the public API', async () => {
      let executionParams!: Parameters<typeof executeWithRestore>[0]
      let finishWorkflow!: (value: never) => void
      vi.mocked(executeWithRestore).mockImplementation(
        (params) =>
          new Promise((resolve) => {
            executionParams = params
            finishWorkflow = resolve
          }),
      )

      const workflow = resurrect.submitWithRestore({
        transaction: makeSampleTx(),
        wallet: makeWallet(),
      })

      expect(resurrect.cancel()).toBe(true)
      expect(executionParams.signal?.aborted).toBe(true)
      expect(resurrect.cancel()).toBe(false)

      finishWorkflow({ success: false, archivedKeysDetected: 0, error: 'Operation cancelled' } as never)
      await workflow
      expect(resurrect.cancel()).toBe(false)
    })

    it('forwards a caller-provided abort signal', async () => {
      const controller = new AbortController()
      let executionParams!: Parameters<typeof executeWithRestore>[0]
      let finishWorkflow!: (value: never) => void
      vi.mocked(executeWithRestore).mockImplementation(
        (params) =>
          new Promise((resolve) => {
            executionParams = params
            finishWorkflow = resolve
          }),
      )

      const workflow = resurrect.submitWithRestore({
        transaction: makeSampleTx(),
        wallet: makeWallet(),
        signal: controller.signal,
      })
      controller.abort()

      expect(executionParams.signal?.aborted).toBe(true)
      finishWorkflow({ success: false, archivedKeysDetected: 0 } as never)
      await workflow
    })

    it('returns result from executeWithRestore on success', async () => {
      const mockResult = {
        success: true,
        originalTxHash: asTxHash('orig-hash'),
        archivedKeysDetected: 0,
      }
      vi.mocked(executeWithRestore).mockImplementation(async (params) => {
        // Simulate the callback that sets success state
        params.onOriginalSubmitted?.(asTxHash('orig-hash'))
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

  describe('previewRestore', () => {
    it('returns a typed restore plan without mutating or submitting the original transaction', async () => {
      const transaction = makeSampleTx()
      const originalXdr = transaction.toXDR()
      const archivedKey = { toXDR: () => 'archived-key-xdr' }
      const sendSpy = vi.spyOn(resurrect.server, 'sendTransaction')
      vi.spyOn(resurrect.server, 'simulateTransaction').mockResolvedValue({
        id: '1',
        latestLedger: 100,
        events: [],
        _parsed: true,
        transactionData: {
          getFootprint: () => ({ readOnly: () => [], readWrite: () => [archivedKey] }),
        },
        minResourceFee: '100',
        cost: { cpuInsns: '100', memBytes: '100' },
        result: { auth: [], retval: { switch: () => 0 } },
        restorePreamble: {
          minResourceFee: '100',
          transactionData: new SorobanDataBuilder(),
        },
      } as never)

      const plan = await resurrect.previewRestore(transaction)
      const simulatedTransaction = vi.mocked(resurrect.server.simulateTransaction).mock.calls[0][0]

      expect(plan).toMatchObject({
        transaction: {
          xdr: originalXdr,
          operationCount: 1,
        },
        network: {
          rpcUrl: testConfig.rpcUrl,
          networkPassphrase: Networks.TESTNET,
        },
        wouldNeedRestore: true,
        archivedKeys: ['archived-key-xdr'],
        minResourceFee: 100,
        feeMultiplier: 3,
        estimatedRestoreFee: '300',
      })
      expect(simulatedTransaction).not.toBe(transaction)
      expect(simulatedTransaction.toXDR()).toBe(originalXdr)
      expect(transaction.toXDR()).toBe(originalXdr)
      expect(resurrect.state).toBe('idle')
      expect(resurrect.history).toHaveLength(0)
      expect(sendSpy).not.toHaveBeenCalled()
    })

    it('reports no restore when simulation succeeds without archived entries', async () => {
      const sendSpy = vi.spyOn(resurrect.server, 'sendTransaction')
      vi.spyOn(resurrect.server, 'simulateTransaction').mockResolvedValue({
        id: '1',
        latestLedger: 100,
        events: [],
        _parsed: true,
        transactionData: new SorobanDataBuilder(),
        minResourceFee: '0',
        cost: { cpuInsns: '100', memBytes: '100' },
        result: { auth: [], retval: { switch: () => 0 } },
      } as never)

      const plan = await resurrect.previewRestore(makeSampleTx())

      expect(plan.wouldNeedRestore).toBe(false)
      expect(plan.archivedKeys).toEqual([])
      expect(plan.estimatedRestoreFee).toBe('0')
      expect(sendSpy).not.toHaveBeenCalled()
    })

    it('surfaces simulation errors rather than returning a success-shaped plan', async () => {
      const sendSpy = vi.spyOn(resurrect.server, 'sendTransaction')
      vi.spyOn(resurrect.server, 'simulateTransaction').mockResolvedValue({
        id: '1',
        latestLedger: 100,
        events: [],
        _parsed: true,
        error: 'simulation rejected',
      } as never)

      await expect(resurrect.previewRestore(makeSampleTx())).rejects.toThrow(
        'Transaction simulation failed: simulation rejected',
      )
      expect(sendSpy).not.toHaveBeenCalled()
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
