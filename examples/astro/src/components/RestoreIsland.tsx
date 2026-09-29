import { useState } from 'react'
import { SorobanResurrectProvider, useSorobanResurrectContext } from '@soroban-resurrect/react-hook'
import type { WalletAdapter } from '@soroban-resurrect/sdk'
import { Networks, Operation, TransactionBuilder, nativeToScVal } from '@stellar/stellar-sdk'

const RPC_URL = 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = Networks.TESTNET
const CONTRACT_ID = 'CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q'

type FreighterApi = {
  isConnected(): Promise<{ isConnected: boolean }>
  getAddress(): Promise<{ address: string }>
  signTransaction(xdr: string, o: { networkPassphrase?: string }): Promise<{ signedTxXdr: string }>
}

// Browser globals are only read inside this function, which is called from an
// event handler — never at module scope — so the module is safe to import
// during Astro's server build.
function freighterAdapter(): WalletAdapter {
  const f = (window as unknown as { freighterApi?: FreighterApi }).freighterApi
  if (!f) throw new Error('Freighter wallet not found.')
  return {
    isConnected: async () => (await f.isConnected()).isConnected,
    getPublicKey: async () => (await f.getAddress()).address,
    signTransaction: async (xdr, opts) =>
      (await f.signTransaction(xdr, { networkPassphrase: opts?.networkPassphrase })).signedTxXdr,
  } as WalletAdapter
}

function Restore() {
  const { resurrect, detectArchivedKeys, submitWithRestore, state, isProcessing } =
    useSorobanResurrectContext()
  const [message, setMessage] = useState('')

  const run = async () => {
    try {
      if (!resurrect) throw new Error('SDK not ready')
      const wallet = freighterAdapter()
      const account = await resurrect.server.getAccount(await wallet.getPublicKey())
      const transaction = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          Operation.invokeContractFunction({
            contract: CONTRACT_ID,
            function: 'get_balance',
            args: [nativeToScVal(1, { type: 'u32' })],
          }),
        )
        .setTimeout(30)
        .build()

      const archived = await detectArchivedKeys(transaction)
      setMessage(`${archived.length} archived key(s) detected`)
      const result = await submitWithRestore({ transaction, wallet })
      setMessage(result.success ? 'Submitted ✓' : 'Submission failed')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div>
      <button onClick={run} disabled={isProcessing}>
        Detect &amp; restore
      </button>
      <p>State: {state}</p>
      <p>{message}</p>
    </div>
  )
}

export default function RestoreIsland() {
  return (
    <SorobanResurrectProvider config={{ rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE }}>
      <Restore />
    </SorobanResurrectProvider>
  )
}
