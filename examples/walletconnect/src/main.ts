import SignClient from '@walletconnect/sign-client'
import QRCode from 'qrcode'
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import {
  WalletConnectAdapter,
  STELLAR_WC_METHODS,
  passphraseToChainId,
  type WalletConnectSessionLike,
} from '@soroban-resurrect/adapter-walletconnect'
import { Networks, Operation, TransactionBuilder, nativeToScVal } from '@stellar/stellar-sdk'

const env = import.meta.env
const PROJECT_ID: string | undefined = env.VITE_WC_PROJECT_ID
const RELAY_URL: string | undefined = env.VITE_WC_RELAY_URL || undefined
const RPC_URL: string = env.VITE_RPC_URL || 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE: string = env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET
const CONTRACT_ID: string =
  env.VITE_CONTRACT_ID || 'CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q'
const CHAIN_ID = passphraseToChainId(NETWORK_PASSPHRASE)

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const logEl = $<HTMLPreElement>('log')
const qr = $<HTMLCanvasElement>('qr')
const connectBtn = $<HTMLButtonElement>('connect')
const disconnectBtn = $<HTMLButtonElement>('disconnect')
const withdrawBtn = $<HTMLButtonElement>('withdraw')
const log = (msg: string) => (logEl.textContent = `${msg}\n${logEl.textContent}`)

const resurrect = new SorobanResurrect({ rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE })
resurrect.onStateChange((info) => info.message && log(info.message))

let client: InstanceType<typeof SignClient> | undefined
let session: WalletConnectSessionLike | undefined
let wallet: WalletConnectAdapter | undefined

function setSession(next: WalletConnectSessionLike | undefined) {
  session = next
  wallet = next ? new WalletConnectAdapter({ client: client!, session: next, networkPassphrase: NETWORK_PASSPHRASE }) : undefined
  qr.hidden = true
  connectBtn.hidden = Boolean(next)
  disconnectBtn.hidden = !next
  withdrawBtn.disabled = !next
  $('session').textContent = next ? `Session ${next.topic.slice(0, 8)}… on ${CHAIN_ID}` : 'Not paired'
}

async function init() {
  if (!PROJECT_ID) {
    log('Set VITE_WC_PROJECT_ID in .env (see .env.example).')
    connectBtn.disabled = true
    return
  }
  client = await SignClient.init({
    projectId: PROJECT_ID,
    relayUrl: RELAY_URL,
    metadata: {
      name: 'Soroban-Resurrect WalletConnect example',
      description: 'Detect and restore archived Soroban state over WalletConnect',
      url: location.origin,
      icons: [],
    },
  })

  // Session lifecycle: the wallet disconnected, or the session expired.
  client.on('session_delete', () => {
    log('Wallet ended the session.')
    setSession(undefined)
  })
  client.on('session_expire', () => {
    log('Session expired — pair again.')
    setSession(undefined)
  })

  // Resume a still-valid session persisted by SignClient from a previous visit.
  const now = Math.floor(Date.now() / 1000)
  const existing = client.session.getAll().find((s) => s.expiry > now && s.namespaces.stellar)
  setSession(existing)
  if (existing) log('Restored previous session.')
}

async function connect() {
  if (!client) return
  try {
    const { uri, approval } = await client.connect({
      requiredNamespaces: {
        stellar: { chains: [CHAIN_ID], methods: [STELLAR_WC_METHODS.signXDR], events: [] },
      },
    })
    if (uri) {
      await QRCode.toCanvas(qr, uri)
      qr.hidden = false
      log('Scan the QR code with a WalletConnect-enabled Stellar wallet.')
    }
    setSession(await approval())
    log('Paired.')
  } catch (err) {
    qr.hidden = true
    log(`Pairing failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function disconnect() {
  if (!client || !session) return
  await client.disconnect({ topic: session.topic, reason: { code: 6000, message: 'User disconnected' } })
  setSession(undefined)
  log('Disconnected.')
}

async function withdraw() {
  if (!wallet) return
  const account = await resurrect.server.getAccount(await wallet.getPublicKey())
  const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(
      Operation.invokeContractFunction({
        contract: CONTRACT_ID,
        function: 'withdraw',
        args: [nativeToScVal(1000, { type: 'i128' })],
      }),
    )
    .setTimeout(30)
    .build()

  const archived = await resurrect.detectArchivedKeys(tx)
  log(archived.length ? `${archived.length} archived key(s) — restore will be requested first.` : 'No restore needed.')

  // Each signature (restore, then the original) is approved on the phone.
  const result = await resurrect.submitWithRestore({ transaction: tx, wallet })
  log(result.success ? `Done: ${result.originalTxHash}` : `Failed: ${result.error}`)
}

connectBtn.addEventListener('click', connect)
disconnectBtn.addEventListener('click', disconnect)
withdrawBtn.addEventListener('click', () => withdraw().catch((e) => log(String(e))))
init().catch((e) => log(`Init failed: ${String(e)}`))
