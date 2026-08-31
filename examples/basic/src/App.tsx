import React, { useState, useCallback } from 'react'
import { SorobanResurrectProvider, useSorobanResurrectContext } from '@soroban-resurrect/react-hook'
import { TransactionBuilder, Operation, Networks, nativeToScVal, rpc } from '@stellar/stellar-sdk'
import { ProgressIndicator } from './components/ProgressIndicator.js'
import { ErrorDisplay } from './components/ErrorDisplay.js'

// Safely read environment variables with fallback defaults
function getEnvVariable(key: string, fallback: string): string {
  try {
    return (import.meta.env as Record<string, string | undefined>)[key] ?? fallback
  } catch (err) {
    console.warn(`Failed to read env var ${key}, using fallback:`, err)
    return fallback
  }
}

const RPC_URL = getEnvVariable('VITE_RPC_URL', 'https://soroban-testnet.stellar.org')
const NETWORK = Networks.TESTNET
const CONTRACT_ID = getEnvVariable(
  'VITE_CONTRACT_ID',
  'CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q',
)
const NETWORK_PASSPHRASE = getEnvVariable('VITE_NETWORK_PASSPHRASE', NETWORK)
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
    <div className="sr-wallet">
      {!walletConnected ? (
        <button className="sr-btn" onClick={connectWallet}>
          Connect Freighter Wallet
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

function WithdrawButton() {
  const { submitWithRestore, state, isProcessing, detectArchivedKeys, reset, resurrect } =
    useSorobanResurrectContext()

  const [lastResult, setLastResult] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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
    setErrorMessage(null)
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
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }
  }, [submitWithRestore, buildSampleTransaction])

  const handleCheckArchived = useCallback(async () => {
    setErrorMessage(null)
    try {
      const tx = await buildSampleTransaction()
      const keys = await detectArchivedKeys(tx)
      if (keys.length === 0) {
        alert('No archived keys detected. All entries are live.')
      } else {
        alert(`Detected ${keys.length} archived ledger entries that need restoration.`)
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }
  }, [detectArchivedKeys, buildSampleTransaction])

  const handleReset = useCallback(() => {
    reset()
    setLastResult(null)
    setErrorMessage(null)
  }, [reset])

  // Prefer the SDK-reported error, fall back to a locally caught one.
  const shownError = state.state === 'error' ? (state.error ?? state.message) : errorMessage

  return (
    <div className="sr-app">
      <h2>Soroban-Resurrect Demo</h2>
      <p className="sr-tagline">
        Submit a contract call that transparently restores any archived state it touches.
      </p>

      <div className="sr-card">
        <WalletButton />

        <div className="sr-actions">
          <button className="sr-btn" onClick={handleCheckArchived} disabled={isProcessing}>
            Check Archived Keys
          </button>
          <button className="sr-btn sr-btn--primary" onClick={handleWithdraw} disabled={isProcessing}>
            {isProcessing ? 'Processing...' : 'Submit Withdraw'}
          </button>
          {(state.state !== 'idle' || lastResult || errorMessage) && (
            <button className="sr-btn" onClick={handleReset}>
              Reset
            </button>
          )}
        </div>

        {state.archivedKeys && state.archivedKeys.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--sr-text-muted)' }}>
            <strong>Archived entries detected:</strong> {state.archivedKeys.length}
          </div>
        )}
      </div>

      <ProgressIndicator state={state.state} message={state.message} />

      {shownError && <ErrorDisplay message={shownError} onRetry={handleWithdraw} />}

      {lastResult && <pre className="sr-result">{lastResult}</pre>}
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
