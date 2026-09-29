// Pre-signature cost confirmation: estimate → show → only then ask to sign.
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import { TransactionBuilder, Operation, Networks, nativeToScVal } from '@stellar/stellar-sdk'

const RPC_URL = 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = Networks.TESTNET
const CONTRACT_ID = 'CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q'
const RESTORE_FEE_MULTIPLIER = 3
const MAX_RESTORE_FEE_STROOPS = 10_000_000

const resurrect = new SorobanResurrect({
  rpcUrl: RPC_URL,
  networkPassphrase: NETWORK_PASSPHRASE,
  restoreFeeMultiplier: RESTORE_FEE_MULTIPLIER,
  maxRestoreFeeStroops: MAX_RESTORE_FEE_STROOPS,
})

const $ = (id) => document.getElementById(id)
const log = (msg) => ($('log').textContent += `${msg}\n`)
let pending = null

$('config').textContent =
  `Fee multiplier: ×${RESTORE_FEE_MULTIPLIER} · Cap: ${MAX_RESTORE_FEE_STROOPS.toLocaleString()} stroops`

function freighter() {
  if (!window.freighterApi) throw new Error('Freighter wallet not found.')
  const f = window.freighterApi
  return {
    isConnected: () => f.isConnected().then((r) => r.isConnected ?? Boolean(r)),
    getPublicKey: async () => (await f.getAddress()).address,
    signTransaction: (xdr, opts) =>
      f
        .signTransaction(xdr, { networkPassphrase: opts?.networkPassphrase })
        .then((r) => r.signedTxXdr ?? r),
  }
}

async function buildTransaction(wallet) {
  const account = await resurrect.server.getAccount(await wallet.getPublicKey())
  return new TransactionBuilder(account, { fee: '100', networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(
      Operation.invokeContractFunction({
        contract: CONTRACT_ID,
        function: 'get_balance',
        args: [nativeToScVal(1, { type: 'u32' })],
      }),
    )
    .setTimeout(30)
    .build()
}

const MOCKS = {
  'mock-restore': { minResourceFee: 42_000, archivedKeysDetected: 2, wouldNeedRestore: true },
  'mock-none': { minResourceFee: 0, archivedKeysDetected: 0, wouldNeedRestore: false },
}

function render(estimate) {
  const { archivedKeysDetected, estimatedFee, minResourceFee, multiplier, wouldNeedRestore } =
    estimate
  if (!wouldNeedRestore) {
    $('result').innerHTML = `<p><strong>No restore needed — 0 stroops extra.</strong></p>`
    return
  }
  const overCap = BigInt(estimatedFee) > BigInt(MAX_RESTORE_FEE_STROOPS)
  $('result').innerHTML = `
    <p><strong>This needs a restore and will cost about ${Number(estimatedFee).toLocaleString()} stroops.</strong></p>
    <ul>
      <li>Archived keys detected: ${archivedKeysDetected}</li>
      <li>Simulated min resource fee: ${minResourceFee.toLocaleString()} stroops</li>
      <li>Multiplier: ×${multiplier}</li>
      <li>Cap: ${MAX_RESTORE_FEE_STROOPS.toLocaleString()} stroops ${overCap ? '— ⚠ estimate exceeds cap, restore will be refused' : ''}</li>
    </ul>`
}

$('estimate').addEventListener('click', async () => {
  $('log').textContent = ''
  $('sign').hidden = true
  pending = null
  try {
    const mode = $('mode').value
    let estimate
    if (mode === 'live') {
      const wallet = freighter()
      const transaction = await buildTransaction(wallet)
      estimate = await resurrect.estimateRestoreCost(transaction) // simulate only — nothing signed
      pending = { wallet, transaction }
    } else {
      const m = MOCKS[mode]
      estimate = {
        ...m,
        multiplier: RESTORE_FEE_MULTIPLIER,
        estimatedFee: String(m.minResourceFee * RESTORE_FEE_MULTIPLIER),
      }
    }
    render(estimate)
    $('sign').hidden = mode !== 'live'
  } catch (err) {
    log(`Error: ${err instanceof Error ? err.message : String(err)}`)
  }
})

// Only after the user has seen the estimate do we ask the wallet to sign.
$('sign').addEventListener('click', async () => {
  if (!pending) return
  try {
    const result = await resurrect.submitWithRestore(pending)
    log(`Submitted: ${JSON.stringify(result)}`)
  } catch (err) {
    log(`Error: ${err instanceof Error ? err.message : String(err)}`)
  }
})
