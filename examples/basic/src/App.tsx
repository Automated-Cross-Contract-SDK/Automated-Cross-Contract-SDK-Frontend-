import React, { useState, useCallback, useMemo } from 'react'
import { SorobanResurrectProvider, useSorobanResurrectContext } from '@soroban-resurrect/react-hook'
import { TransactionBuilder, Operation, Networks, nativeToScVal, rpc } from '@stellar/stellar-sdk'

// Safely read environment variables with fallback defaults
function getEnvVariable(key: string, fallback: string): string {
  try {
    return (import.meta.env as Record<string, string | undefined>)[key] ?? fallback
  } catch (err) {
    console.warn(`Failed to read env var ${key}, using fallback:`, err)
    return fallback
  }
}

const DEFAULT_RPC_URL = getEnvVariable('VITE_RPC_URL', 'https://soroban-testnet.stellar.org')
const DEFAULT_NETWORK_PASSPHRASE = getEnvVariable('VITE_NETWORK_PASSPHRASE', Networks.TESTNET)
const CONTRACT_ID = getEnvVariable(
  'VITE_CONTRACT_ID',
  'CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q',
)

// ---------------------------------------------------------------------------
// Network selector (issue #138)
// ---------------------------------------------------------------------------

type NetworkId = 'testnet' | 'mainnet' | 'futurenet' | 'custom'

interface NetworkConfig {
  rpcUrl: string
  networkPassphrase: string
}

const NETWORK_PRESETS: Record<Exclude<NetworkId, 'custom'>, NetworkConfig & { label: string }> = {
  testnet: {
    label: 'Testnet',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: Networks.TESTNET,
  },
  mainnet: {
    label: 'Mainnet',
    rpcUrl: 'https://mainnet.sorobanrpc.com',
    networkPassphrase: Networks.PUBLIC,
  },
  futurenet: {
    label: 'Futurenet',
    rpcUrl: 'https://rpc-futurenet.stellar.org',
    networkPassphrase: Networks.FUTURENET,
  },
}

function NetworkSelector({
  networkId,
  custom,
  onNetworkChange,
  onCustomChange,
}: {
  networkId: NetworkId
  custom: NetworkConfig
  onNetworkChange: (id: NetworkId) => void
  onCustomChange: (cfg: NetworkConfig) => void
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 13, fontWeight: 600, marginRight: 8 }}>Network:</label>
      <select
        aria-label="Network"
        value={networkId}
        onChange={(e) => onNetworkChange(e.target.value as NetworkId)}
        style={{ padding: '4px 8px', borderRadius: 4 }}
      >
        <option value="testnet">Testnet</option>
        <option value="mainnet">Mainnet</option>
        <option value="futurenet">Futurenet</option>
        <option value="custom">Custom</option>
      </select>

      {networkId === 'custom' && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 480 }}>
          <input
            aria-label="Custom RPC URL"
            placeholder="RPC URL (https://...)"
            value={custom.rpcUrl}
            onChange={(e) => onCustomChange({ ...custom, rpcUrl: e.target.value })}
            style={{ padding: '4px 8px', borderRadius: 4 }}
          />
          <input
            aria-label="Custom network passphrase"
            placeholder="Network passphrase"
            value={custom.networkPassphrase}
            onChange={(e) => onCustomChange({ ...custom, networkPassphrase: e.target.value })}
            style={{ padding: '4px 8px', borderRadius: 4 }}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Wallet connection status indicator (issue #137)
// ---------------------------------------------------------------------------

type WalletStatus = 'disconnected' | 'connecting' | 'connected'

const WALLET_STATUS_META: Record<WalletStatus, { label: string; color: string }> = {
  disconnected: { label: 'Disconnected', color: '#dc3545' },
  connecting: { label: 'Connecting…', color: '#ffc107' },
  connected: { label: 'Connected', color: '#28a745' },
}

function WalletStatusIndicator({ status }: { status: WalletStatus }) {
  const meta = WALLET_STATUS_META[status]
  return (
    <span
      role="status"
      aria-label={`Wallet ${meta.label}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          backgroundColor: meta.color,
          boxShadow: status === 'connecting' ? `0 0 0 3px ${meta.color}33` : 'none',
        }}
      />
      Wallet: {meta.label}
    </span>
  )
}

function getStellarWallet(): StellarWallet {
  if (typeof window === 'undefined' || !window.stellar) {
    throw new Error('Freighter wallet not found. Please install the Freighter extension.')
  }
  return window.stellar
}

function WalletButton() {
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [status, setStatus] = useState<WalletStatus>('disconnected')

  const connectWallet = useCallback(async () => {
    setStatus('connecting')
    try {
      const stellar = getStellarWallet()
      await stellar.connect()
      const pubKey = await stellar.getPublicKey()
      setPublicKey(pubKey)
      setStatus('connected')
    } catch (err) {
      console.error('Failed to connect wallet:', err)
      setStatus('disconnected')
      alert('Failed to connect wallet. Please ensure Freighter is installed and unlocked.')
    }
  }, [])

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 8 }}>
        <WalletStatusIndicator status={status} />
      </div>
      {status !== 'connected' ? (
        <button onClick={connectWallet} disabled={status === 'connecting'}>
          {status === 'connecting' ? 'Connecting…' : 'Connect Freighter Wallet'}
        </button>
      ) : (
        <div>
          Connected:{' '}
          <code>
            {publicKey?.slice(0, 8)}...{publicKey?.slice(-4)}
          </code>
        </div>
      )}
    </div>
  )
}

function WithdrawButton({ networkPassphrase }: { networkPassphrase: string }) {
  const { submitWithRestore, state, isProcessing, detectArchivedKeys, reset, resurrect } =
    useSorobanResurrectContext()

  const [lastResult, setLastResult] = useState<string | null>(null)

  const buildSampleTransaction = useCallback(async () => {
    const stellar = getStellarWallet()
    const pubKey = await stellar.getPublicKey()
    const sdkServer = resurrect?.server ?? new rpc.Server(DEFAULT_RPC_URL)
    const account = await sdkServer.getAccount(pubKey)

    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: CONTRACT_ID,
          function: 'withdraw',
          args: [nativeToScVal(1000, { type: 'i128' })],
        }),
      )
      .setTimeout(30)
      .build()

    return tx
  }, [networkPassphrase, resurrect])

  const handleWithdraw = useCallback(async () => {
    setLastResult(null)
    try {
      const stellar = getStellarWallet()
      const wallet = {
        isConnected: async () => true,
        getPublicKey: async () => stellar.getPublicKey(),
        signTransaction: async (
          tx: string,
          opts?: { networkPassphrase?: string; network?: string },
        ) => stellar.signTransaction(tx, opts),
      }

      const tx = await buildSampleTransaction()
      const result = await submitWithRestore(tx, wallet)
      setLastResult(JSON.stringify(result, null, 2))
    } catch (err) {
      setLastResult(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [submitWithRestore, buildSampleTransaction])

  const handleCheckArchived = useCallback(async () => {
    try {
      const tx = await buildSampleTransaction()
      const keys = await detectArchivedKeys(tx)
      if (keys.length === 0) {
        alert('No archived keys detected. All entries are live.')
      } else {
        alert(`Detected ${keys.length} archived ledger entries that need restoration.`)
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [detectArchivedKeys, buildSampleTransaction])

  const statusColor = (() => {
    switch (state.state) {
      case 'error':
        return '#dc3545'
      case 'success':
        return '#28a745'
      case 'restore_needed':
        return '#ffc107'
      default:
        return '#6c757d'
    }
  })()

  return (
    <>
      <div style={{ marginTop: 20 }}>
        <button onClick={handleCheckArchived} disabled={isProcessing} style={{ marginRight: 8 }}>
          Check Archived Keys
        </button>
        <button
          onClick={handleWithdraw}
          disabled={isProcessing}
          style={{
            backgroundColor: isProcessing ? '#ccc' : '#007bff',
            color: '#fff',
            border: 'none',
            padding: '8px 16px',
            borderRadius: 4,
            cursor: isProcessing ? 'not-allowed' : 'pointer',
          }}
        >
          {isProcessing ? 'Processing...' : 'Submit Withdraw'}
        </button>
        {(state.state !== 'idle' || lastResult) && (
          <button onClick={() => reset()} style={{ marginLeft: 8 }}>
            Reset
          </button>
        )}
      </div>

      {state.message && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 4,
            border: `1px solid ${statusColor}`,
            color: statusColor,
          }}
        >
          <strong>Status:</strong> {state.message}
        </div>
      )}

      {state.archivedKeys && state.archivedKeys.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 13, opacity: 0.7 }}>
          <strong>Archived entries detected:</strong> {state.archivedKeys.length}
        </div>
      )}

      {lastResult && (
        <pre
          style={{
            marginTop: 16,
            padding: 12,
            backgroundColor: '#f5f5f5',
            borderRadius: 4,
            fontSize: 13,
            overflow: 'auto',
          }}
        >
          {lastResult}
        </pre>
      )}
    </>
  )
}

export default function App() {
  const [networkId, setNetworkId] = useState<NetworkId>('testnet')
  const [custom, setCustom] = useState<NetworkConfig>({
    rpcUrl: DEFAULT_RPC_URL,
    networkPassphrase: DEFAULT_NETWORK_PASSPHRASE,
  })

  const activeNetwork: NetworkConfig = useMemo(() => {
    if (networkId === 'custom') return custom
    const preset = NETWORK_PRESETS[networkId]
    return { rpcUrl: preset.rpcUrl, networkPassphrase: preset.networkPassphrase }
  }, [networkId, custom])

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: 24 }}>
      <h2>Soroban-Resurrect Demo</h2>

      <NetworkSelector
        networkId={networkId}
        custom={custom}
        onNetworkChange={setNetworkId}
        onCustomChange={setCustom}
      />
      <WalletButton />

      <SorobanResurrectProvider
        // Re-mount the provider when the network changes so the SDK picks up the new RPC.
        key={`${activeNetwork.rpcUrl}|${activeNetwork.networkPassphrase}`}
        config={{
          rpcUrl: activeNetwork.rpcUrl,
          networkPassphrase: activeNetwork.networkPassphrase,
        }}
      >
        <WithdrawButton networkPassphrase={activeNetwork.networkPassphrase} />
      </SorobanResurrectProvider>
    </div>
  )
}
