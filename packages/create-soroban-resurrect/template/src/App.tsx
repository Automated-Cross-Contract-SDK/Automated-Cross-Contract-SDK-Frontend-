import { useCallback, useEffect, useMemo, useState } from 'react'
import { Contract, Networks, TransactionBuilder } from '@stellar/stellar-sdk'
import { SorobanResurrect, createAdapter, type WalletAdapter } from '@soroban-resurrect/sdk'

const NETWORKS = {
  testnet: { rpcUrl: 'https://soroban-testnet.stellar.org', networkPassphrase: Networks.TESTNET },
  futurenet: { rpcUrl: 'https://rpc-futurenet.stellar.org', networkPassphrase: Networks.FUTURENET },
  mainnet: { rpcUrl: 'https://mainnet.sorobanrpc.com', networkPassphrase: Networks.PUBLIC },
}

const network = NETWORKS[import.meta.env.VITE_NETWORK ?? 'testnet']
const WALLET = import.meta.env.VITE_WALLET ?? 'freighter'
const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID ?? ''
const CONTRACT_FN = import.meta.env.VITE_CONTRACT_FN ?? 'hello'
/** Warn when the contract instance has less than ~1 day (5s ledgers) left. */
const TTL_WARNING_LEDGERS = 17_280

export function App() {
  const sr = useMemo(() => new SorobanResurrect(network), [])
  const [wallet, setWallet] = useState<WalletAdapter | null>(null)
  const [publicKey, setPublicKey] = useState('')
  const [ttlLedgers, setTtlLedgers] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const contract = useMemo(() => (CONTRACT_ID ? new Contract(CONTRACT_ID) : null), [])

  useEffect(() => {
    if (!contract) return
    sr.queryLedgerEntryTTL(contract.getFootprint())
      .then((info) => setTtlLedgers(info.ttlLedgers))
      .catch(() => setTtlLedgers(null))
  }, [sr, contract])

  const connect = useCallback(async () => {
    const adapter = await createAdapter(WALLET)
    await (adapter as { connect?: () => Promise<void> }).connect?.()
    setPublicKey(await adapter.getPublicKey())
    setWallet(adapter)
  }, [])

  const run = useCallback(async () => {
    if (!wallet || !contract) return
    setBusy(true)
    setStatus('Simulating…')
    try {
      const account = await sr.server.getAccount(publicKey)
      const transaction = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: network.networkPassphrase,
      })
        .addOperation(contract.call(CONTRACT_FN))
        .setTimeout(30)
        .build()
      const result = await sr.submitWithRestore({ transaction, wallet })
      setStatus(`Done: ${JSON.stringify(result)}`)
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }, [sr, wallet, publicKey, contract])

  return (
    <main
      style={{ fontFamily: 'system-ui', maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}
    >
      <h1>Soroban Resurrect</h1>
      <p>
        Network: <b>{import.meta.env.VITE_NETWORK ?? 'testnet'}</b> · Wallet: <b>{WALLET}</b>
      </p>

      {!CONTRACT_ID && <p role="alert">Set VITE_CONTRACT_ID in .env to a deployed contract.</p>}

      {ttlLedgers !== null && ttlLedgers < TTL_WARNING_LEDGERS && (
        <p role="alert" style={{ color: '#b45309' }}>
          {ttlLedgers === 0
            ? 'Contract instance is archived — the next call will restore it first.'
            : `Contract instance expires in ${ttlLedgers} ledgers.`}
        </p>
      )}

      {wallet ? <p>Connected: {publicKey}</p> : <button onClick={connect}>Connect {WALLET}</button>}

      <button onClick={run} disabled={!wallet || !contract || busy}>
        {busy ? 'Working…' : `Call ${CONTRACT_FN} (auto-restore)`}
      </button>

      {status && <pre style={{ whiteSpace: 'pre-wrap' }}>{status}</pre>}
    </main>
  )
}
