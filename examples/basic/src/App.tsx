import React, { useState, useCallback } from 'react'
import { SorobanResurrectProvider, useSorobanResurrectContext } from '@soroban-resurrect/react-hook'
import { TransactionBuilder, Operation, Networks, nativeToScVal, rpc } from '@stellar/stellar-sdk'

const RPC_URL = import.meta.env.VITE_RPC_URL ?? 'https://soroban-testnet.stellar.org'
const NETWORK = Networks.TESTNET
const CONTRACT_ID =
  import.meta.env.VITE_CONTRACT_ID ?? 'CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q'
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE ?? NETWORK
const server = new rpc.Server(RPC_URL)

function getStellarWallet(): StellarWallet {
  if (typeof window === 'undefined' || !window.stellar) {
    throw new Error('Freighter wallet not found. Please install the Freighter extension.')
  }
  return window.stellar
}

function WalletButton() {
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [walletConnected, setWalletConnected] = useState(false)

  const connectWallet = useCallback(async () => {
    try {
      const stellar = getStellarWallet()
      await stellar.connect()
      const pubKey = await stellar.getPublicKey()
      setPublicKey(pubKey)
      setWalletConnected(true)
    } catch (err) {
      console.error('Failed to connect wallet:', err)
      alert('Failed to connect wallet. Please ensure Freighter is installed and unlocked.')
    }
  }, [])

  return (
    <div style={{ marginBottom: 16 }}>
      {!walletConnected ? (
        <button onClick={connectWallet}>Connect Freighter Wallet</button>
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

function WithdrawButton() {
  const { submitWithRestore, state, isProcessing, detectArchivedKeys, reset, resurrect } =
    useSorobanResurrectContext()

  const [lastResult, setLastResult] = useState<string | null>(null)

  const buildSampleTransaction = useCallback(async () => {
    const stellar = getStellarWallet()
    const pubKey = await stellar.getPublicKey()
    const sdkServer = resurrect?.server ?? server
    const account = await sdkServer.getAccount(pubKey)

    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: NETWORK,
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
  }, [])

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
    <div style={{ maxWidth: 600, margin: '0 auto', padding: 24 }}>
      <h2>Soroban-Resurrect Demo</h2>
      <WalletButton />

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
          <button onClick={reset} style={{ marginLeft: 8 }}>
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
    </div>
  )
}

export default function App() {
  return (
    <SorobanResurrectProvider
      config={{
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
      }}
    >
      <WithdrawButton />
    </SorobanResurrectProvider>
  )
}
