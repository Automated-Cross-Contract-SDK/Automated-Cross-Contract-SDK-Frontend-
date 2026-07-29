'use client'

import { useCallback, useState } from 'react'
import { useSorobanResurrectContext } from '@soroban-resurrect/react-hook'
import { TransactionBuilder, Operation, Networks, nativeToScVal } from '@stellar/stellar-sdk'

const NETWORK_PASSPHRASE = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? Networks.TESTNET
const CONTRACT_ID =
  process.env.NEXT_PUBLIC_CONTRACT_ID ?? 'CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q'

interface FreighterApi {
  isConnected(): Promise<{ isConnected: boolean }>
  getAddress(): Promise<{ address: string }>
  signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string },
  ): Promise<{ signedTxXdr: string }>
}

declare global {
  interface Window {
    freighterApi?: FreighterApi
  }
}

export function WithdrawCard() {
  const { resurrect, submitWithRestore, state, isProcessing } = useSorobanResurrectContext()
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)

  const connectWallet = useCallback(async () => {
    if (!window.freighterApi) {
      alert('Freighter wallet not found. Please install the Freighter extension.')
      return
    }
    const { address } = await window.freighterApi.getAddress()
    setPublicKey(address)
  }, [])

  const handleWithdraw = useCallback(async () => {
    if (!publicKey || !resurrect) return
    setLastResult(null)

    try {
      const freighter = window.freighterApi!
      const wallet = {
        isConnected: async () => (await freighter.isConnected()).isConnected,
        getPublicKey: async () => (await freighter.getAddress()).address,
        signTransaction: async (xdr: string, opts?: { networkPassphrase?: string }) =>
          (await freighter.signTransaction(xdr, opts)).signedTxXdr,
      }

      const account = await resurrect.server.getAccount(publicKey)
      const transaction = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: NETWORK_PASSPHRASE,
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

      const result = await submitWithRestore(transaction, wallet)
      setLastResult(JSON.stringify(result, null, 2))
    } catch (err) {
      setLastResult(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [publicKey, resurrect, submitWithRestore])

  return (
    <div style={{ marginTop: 24 }}>
      {publicKey ? (
        <p>
          Connected: <code>{publicKey.slice(0, 8)}...{publicKey.slice(-4)}</code>
        </p>
      ) : (
        <button onClick={connectWallet}>Connect Freighter Wallet</button>
      )}

      <div style={{ marginTop: 16 }}>
        <button onClick={handleWithdraw} disabled={!publicKey || isProcessing}>
          {isProcessing ? 'Processing...' : 'Submit Withdraw'}
        </button>
      </div>

      {state.message && (
        <p style={{ marginTop: 16 }}>
          <strong>Status:</strong> {state.message}
        </p>
      )}

      {lastResult && (
        <pre style={{ marginTop: 16, padding: 12, background: '#f5f5f5', overflow: 'auto' }}>
          {lastResult}
        </pre>
      )}
    </div>
  )
}
