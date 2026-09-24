'use client'

import { useCallback, useState } from 'react'
import { useSorobanResurrectContext } from '@soroban-resurrect/react-hook'
import { buildWithdrawTransaction } from './lib/withdraw-tx'
import { CLIENT_NETWORK_PASSPHRASE, CONTRACT_ID } from './lib/client-config'
import { getFreighterApi } from './lib/freighter'

interface RestoreButtonProps {
  /** Public key the Server Component ran detection for. */
  account: string
  /**
   * Whether the server detected archived ledger entries. Drives the label so
   * the user sees the same verdict the server rendered.
   */
  needsRestore: boolean
}

/**
 * Client Component that owns the restore flow.
 *
 * The server already decided *whether* a restore is needed; this component
 * only handles the parts that require the wallet — rebuilding the transaction
 * against the live sequence number, signing, and submitting through the SDK's
 * `submitWithRestore`, which restores archived entries before retrying the
 * original transaction.
 */
export function RestoreButton({ account, needsRestore }: RestoreButtonProps) {
  const { resurrect, submitWithRestore, state, isProcessing } = useSorobanResurrectContext()
  const [lastResult, setLastResult] = useState<string | null>(null)

  const handleClick = useCallback(async () => {
    setLastResult(null)

    const freighter = getFreighterApi()
    if (!freighter || !resurrect) {
      setLastResult('Freighter wallet not found. Install the extension to continue.')
      return
    }

    try {
      const wallet = {
        isConnected: async () => (await freighter.isConnected()).isConnected,
        getPublicKey: async () => (await freighter.getAddress()).address,
        signTransaction: async (xdr: string, opts?: { networkPassphrase?: string }) =>
          (await freighter.signTransaction(xdr, opts)).signedTxXdr,
      }

      // Rebuild client-side so the sequence number is current, then let the
      // SDK restore any archived entries before submitting.
      const transaction = await buildWithdrawTransaction(
        resurrect.server,
        account,
        CLIENT_NETWORK_PASSPHRASE,
        CONTRACT_ID,
      )

      const result = await submitWithRestore(transaction, wallet)
      setLastResult(JSON.stringify(result, null, 2))
    } catch (err) {
      setLastResult(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [account, resurrect, submitWithRestore])

  return (
    <div style={{ marginTop: 16 }}>
      <button onClick={handleClick} disabled={isProcessing}>
        {isProcessing
          ? state.message || 'Processing…'
          : needsRestore
            ? 'Restore & Withdraw'
            : 'Withdraw'}
      </button>

      {state.message && (
        <p style={{ marginTop: 12 }}>
          <strong>Status:</strong> {state.message}
        </p>
      )}

      {lastResult && (
        <pre style={{ marginTop: 12, padding: 12, background: '#f5f5f5', overflow: 'auto' }}>
          {lastResult}
        </pre>
      )}
    </div>
  )
}
