import React, { useCallback, useState } from 'react'
import { SorobanResurrectProvider, useSorobanResurrectContext } from '@soroban-resurrect/react-hook'
import { TransactionBuilder, Operation, Networks, nativeToScVal, xdr } from '@stellar/stellar-sdk'

const RPC_URL = 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = Networks.TESTNET

// A single SorobanResurrect instance (one RPC connection, one restore
// workflow state machine) is shared across every contract interaction below
// — archive detection/restoration is a network-level concern, not something
// scoped per contract.
interface ContractAction {
  id: string
  contractName: string
  contractId: string
  functionName: string
  args: xdr.ScVal[]
  label: string
}

const CONTRACTS: ContractAction[] = [
  {
    id: 'vault-withdraw',
    contractName: 'Vault',
    contractId: 'CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q',
    functionName: 'withdraw',
    args: [nativeToScVal(1000, { type: 'i128' })],
    label: 'Withdraw 1000 from Vault',
  },
  {
    id: 'token-transfer',
    contractName: 'Token',
    contractId: 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE',
    functionName: 'transfer',
    args: [
      nativeToScVal('GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37', { type: 'address' }),
      nativeToScVal(500, { type: 'i128' }),
    ],
    label: 'Transfer 500 Token',
  },
]

function getStellarWallet(): StellarWallet {
  if (typeof window === 'undefined' || !window.stellar) {
    throw new Error('Freighter wallet not found. Please install the Freighter extension.')
  }
  return window.stellar
}

function ContractActionCard({ action }: { action: ContractAction }) {
  const { resurrect, submitWithRestore, state, isProcessing } = useSorobanResurrectContext()
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = useCallback(async () => {
    if (!resurrect) return
    setBusy(true)
    setLastResult(null)

    try {
      const stellar = getStellarWallet()
      const publicKey = await stellar.getPublicKey()
      const wallet = {
        isConnected: async () => true,
        getPublicKey: async () => stellar.getPublicKey(),
        signTransaction: async (
          tx: string,
          opts?: { networkPassphrase?: string; network?: string },
        ) => stellar.signTransaction(tx, opts),
      }

      // Every action reuses the same shared `resurrect.server` connection —
      // only the target contract and invoked function differ per card.
      const account = await resurrect.server.getAccount(publicKey)
      const transaction = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          Operation.invokeContractFunction({
            contract: action.contractId,
            function: action.functionName,
            args: action.args,
          }),
        )
        .setTimeout(30)
        .build()

      const result = await submitWithRestore(transaction, wallet)
      setLastResult(JSON.stringify(result, null, 2))
    } catch (err) {
      setLastResult(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }, [resurrect, submitWithRestore, action])

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>{action.contractName}</h3>
      <p style={{ fontSize: 12, opacity: 0.7, wordBreak: 'break-all' }}>{action.contractId}</p>
      <button onClick={handleSubmit} disabled={busy || isProcessing}>
        {busy ? 'Processing...' : action.label}
      </button>
      {busy && state.message && (
        <p style={{ marginTop: 8, fontSize: 13 }}>
          <strong>Status:</strong> {state.message}
        </p>
      )}
      {lastResult && (
        <pre style={{ marginTop: 8, padding: 8, background: '#f5f5f5', fontSize: 12, overflow: 'auto' }}>
          {lastResult}
        </pre>
      )}
    </div>
  )
}

function ConnectWallet() {
  const [publicKey, setPublicKey] = useState<string | null>(null)

  const connect = useCallback(async () => {
    try {
      const stellar = getStellarWallet()
      const { publicKey: pubKey } = await stellar.connect()
      setPublicKey(pubKey)
    } catch (err) {
      alert(`Failed to connect wallet: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  return (
    <div style={{ marginBottom: 24 }}>
      {publicKey ? (
        <span>
          Connected: <code>{publicKey.slice(0, 8)}...{publicKey.slice(-4)}</code>
        </span>
      ) : (
        <button onClick={connect}>Connect Freighter Wallet</button>
      )}
    </div>
  )
}

export default function App() {
  return (
    <SorobanResurrectProvider config={{ rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' }}>
        <h2>Soroban-Resurrect – Multi-Contract Demo</h2>
        <p>
          A single <code>SorobanResurrectProvider</code> — one RPC connection and restore
          workflow — is reused across interactions with two independent contracts below. Each
          card builds and submits its own transaction through the shared{' '}
          <code>submitWithRestore</code>.
        </p>
        <ConnectWallet />
        {CONTRACTS.map((action) => (
          <ContractActionCard key={action.id} action={action} />
        ))}
      </div>
    </SorobanResurrectProvider>
  )
}
