import { useCallback, useEffect, useState } from 'react'
import { Contract, Networks, TransactionBuilder } from '@stellar/stellar-sdk'
import {
  SorobanResurrect,
  createLedgerAdapter,
  type LedgerWalletAdapter,
  type ISorobanRpcClient,
} from '@soroban-resurrect/sdk'

const MOCK = import.meta.env.MODE === 'mock'
const NETWORK = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
}
const CONTRACT_ID =
  (import.meta.env.VITE_CONTRACT_ID as string | undefined) ??
  'CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q'

async function openTransport(): Promise<unknown> {
  if (MOCK) return (await import('./mock/MockStellarApp.js')).mockTransport
  const { default: TransportWebUSB } = await import('@ledgerhq/hw-transport-webusb')
  return TransportWebUSB.create()
}

/** Mock mode runs fully offline against the shared restore-flow RPC harness. */
async function rpcClientFor(publicKey: string): Promise<ISorobanRpcClient | undefined> {
  if (!MOCK) return undefined
  const { createMockRpcClient, fixtures, scenarios } = await import('@soroban-resurrect/testing')
  return createMockRpcClient({
    ...scenarios.restore(),
    ...scenarios.slowConfirmation(2),
    account: fixtures.account(publicKey),
  })
}

export function App() {
  const [accountIndex, setAccountIndex] = useState(0)
  const [adapter, setAdapter] = useState<LedgerWalletAdapter | null>(null)
  const [sr, setSr] = useState<SorobanResurrect | null>(null)
  const [publicKey, setPublicKey] = useState('')
  const [appVersion, setAppVersion] = useState('')
  const [log, setLog] = useState<string[]>([])
  const [awaitingDevice, setAwaitingDevice] = useState(false)
  const [busy, setBusy] = useState(false)

  const say = (line: string) => setLog((l) => [...l, line])

  useEffect(() => {
    const onConfirm = () => setAwaitingDevice(true)
    window.addEventListener('ledger-mock:confirm', onConfirm)
    return () => window.removeEventListener('ledger-mock:confirm', onConfirm)
  }, [])

  const connect = useCallback(async () => {
    setBusy(true)
    try {
      const ledger = createLedgerAdapter({ transport: await openTransport(), accountIndex })
      await ledger.connect()
      const pk = await ledger.getPublicKey()
      setAppVersion(await ledger.getAppVersion())
      setPublicKey(pk)
      setAdapter(ledger)
      setSr(
        new SorobanResurrect({
          ...NETWORK,
          rpcClient: await rpcClientFor(pk),
          pollIntervalMs: 500,
        }),
      )
      say(`Connected account #${accountIndex} (m/44'/148'/${accountIndex}')`)
    } catch (err) {
      say(`Connect failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }, [accountIndex])

  const disconnect = useCallback(async () => {
    await adapter?.disconnect()
    setAdapter(null)
    setSr(null)
    setPublicKey('')
  }, [adapter])

  const detectAndRestore = useCallback(async () => {
    if (!adapter || !sr) return
    setBusy(true)
    try {
      const build = async () =>
        new TransactionBuilder(await sr.server.getAccount(publicKey), {
          fee: '100',
          networkPassphrase: NETWORK.networkPassphrase,
        })
          .addOperation(new Contract(CONTRACT_ID).call('hello'))
          .setTimeout(120) // hardware signing is slow — leave room for review on-device
          .build()

      const archived = await sr.detectArchivedKeys(await build())
      say(`Detected ${archived.length} archived entr${archived.length === 1 ? 'y' : 'ies'}`)

      say('Restoring — confirm each signature on your Ledger…')
      const result = await sr.submitWithRestore({ transaction: await build(), wallet: adapter })
      say(`Restored and resubmitted: ${JSON.stringify(result)}`)
    } catch (err) {
      say(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAwaitingDevice(false)
      setBusy(false)
    }
  }, [adapter, sr, publicKey])

  return (
    <main
      style={{ fontFamily: 'system-ui', maxWidth: 680, margin: '2rem auto', padding: '0 1rem' }}
    >
      <h1>Ledger restore demo</h1>
      {MOCK && <p>Mock mode: simulated device and offline RPC — no hardware or funds needed.</p>}

      {!adapter ? (
        <p>
          <label>
            BIP44 account index{' '}
            <input
              type="number"
              min={0}
              value={accountIndex}
              onChange={(e) => setAccountIndex(Number(e.target.value))}
              style={{ width: 64 }}
            />
          </label>{' '}
          <button onClick={connect} disabled={busy}>
            Connect Ledger
          </button>
        </p>
      ) : (
        <p>
          {publicKey} · Stellar app {appVersion}{' '}
          <button onClick={disconnect} disabled={busy}>
            Disconnect
          </button>
        </p>
      )}

      <button onClick={detectAndRestore} disabled={!adapter || busy}>
        Detect archived keys &amp; restore
      </button>

      {awaitingDevice && busy && (
        <p role="status" style={{ color: '#b45309' }}>
          Review the transaction hash on your device and approve it.
        </p>
      )}

      <pre style={{ whiteSpace: 'pre-wrap' }}>{log.join('\n')}</pre>
    </main>
  )
}
