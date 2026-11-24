#!/usr/bin/env node
/**
 * End-to-end check of the built SDK against Stellar testnet, using throwaway
 * friendbot-funded accounts. Mocks cannot prove that the network accepts what
 * we build, so this runs on a schedule (.github/workflows/testnet.yml).
 *
 * Usage: npm run build:sdk && npm run check:testnet
 */
import assert from 'node:assert/strict'
import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  hash,
  nativeToScVal,
  rpc,
  xdr,
} from '@stellar/stellar-sdk'
import { SorobanResurrect } from '@soroban-resurrect/sdk'

const rpcUrl = 'https://soroban-testnet.stellar.org'
const networkPassphrase = Networks.TESTNET
const server = new rpc.Server(rpcUrl)
// Restoring a large contract costs more than the default 1 XLM cap.
const sdk = new SorobanResurrect({ rpcUrl, networkPassphrase, maxRestoreFeeStroops: 200_000_000 })

async function fund() {
  const keypair = Keypair.random()
  const response = await fetch(`https://friendbot.stellar.org/?addr=${keypair.publicKey()}`)
  assert.ok(response.ok, `friendbot failed with HTTP ${response.status}`)
  return keypair
}

const user = await fund()
const recipient = (await fund()).publicKey()
let signatures = 0
const wallet = {
  isConnected: async () => true,
  getPublicKey: async () => user.publicKey(),
  signTransaction: async (envelope) => {
    signatures++
    const tx = TransactionBuilder.fromXdr(envelope, networkPassphrase)
    tx.sign(user)
    return tx.toXdr()
  },
}

async function call(contractId, method, ...args) {
  return new TransactionBuilder(await server.getAccount(user.publicKey()), {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(120)
    .build()
}

const xlm = Asset.native().contractId(networkPassphrase)
const transfer = () =>
  call(
    xlm,
    'transfer',
    new Address(user.publicKey()).toScVal(),
    new Address(recipient).toScVal(),
    nativeToScVal(10_000_000n, { type: 'i128' }),
  )

console.log('1. a call that needs no restore confirms')
const stale = await transfer()
const plain = await sdk.submitWithRestore({ transaction: await transfer(), wallet })
assert.ok(plain.success, plain.error)
assert.equal(plain.archivedKeysDetected, 0)

console.log('2. a rejected submission fails fast')
const started = Date.now()
const rejected = await sdk.submitWithRestore({ transaction: stale, wallet })
assert.equal(rejected.errorCode, 'ORIGINAL_TX_FAILED', rejected.error)
assert.ok(Date.now() - started < 20_000, 'rejection should not wait for the confirmation timeout')

console.log('   a sponsored (fee-bump) submission confirms')
const sponsor = await fund()
const sponsored = await sdk.submitWithRestore({
  transaction: await transfer(),
  wallet,
  feeBumpConfig: {
    sponsor: {
      getPublicKey: async () => sponsor.publicKey(),
      signFeeBump: async (envelope) => {
        const tx = TransactionBuilder.fromXdr(envelope, networkPassphrase)
        tx.sign(sponsor)
        return tx.toXdr()
      },
    },
  },
})
assert.ok(sponsored.success, sponsored.error)

console.log('   a call needing another account (SEP-43 signAuthEntry) confirms')
const owner = await fund()
const authorized = await sdk.submitWithRestore({
  transaction: await call(
    xlm,
    'transfer',
    new Address(owner.publicKey()).toScVal(),
    new Address(user.publicKey()).toScVal(),
    nativeToScVal(10_000_000n, { type: 'i128' }),
  ),
  wallet: {
    ...wallet,
    signAuthEntry: async (preimage) =>
      Buffer.from(owner.sign(hash(Buffer.from(preimage, 'base64')))).toString('base64'),
  },
})
assert.ok(authorized.success, authorized.error)

// Testnet entries live about 7 days, so contracts used at the start of the RPC
// retention window are a steady supply of genuinely archived entries.
console.log('3. looking for archived contracts')
const instanceKey = (contractId) =>
  xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
    }),
  )

async function liveUntil(contractId) {
  const { entries, latestLedger } = await server.getLedgerEntries(instanceKey(contractId))
  return { liveUntil: entries[0]?.liveUntilLedgerSeq ?? 0, latestLedger }
}

async function findArchivedContracts() {
  const { oldestLedger } = await server.getHealth()
  const contracts = new Set()
  let cursor
  for (let page = 0; page < 15; page++) {
    const result = await server.getTransactions(
      cursor
        ? { pagination: { cursor, limit: 200 } }
        : { startLedger: oldestLedger + 50, pagination: { limit: 200 } },
    )
    cursor = result.cursor
    for (const { envelopeXdr: envelope } of result.transactions) {
      const v1 =
        envelope.type === 'envelopeTypeTx'
          ? envelope.v1
          : envelope.type === 'envelopeTypeTxFeeBump'
            ? envelope.feeBump.tx.innerTx.v1
            : undefined
      if (!v1 || !('sorobanData' in v1.tx.ext)) continue
      const { readOnly, readWrite } = v1.tx.ext.sorobanData.resources.footprint
      for (const key of [...readOnly, ...readWrite]) {
        if (
          key.type === 'contractData' &&
          key.contractData.key.type === 'scvLedgerKeyContractInstance'
        ) {
          contracts.add(Address.fromScAddress(key.contractData.contract).toString())
        }
      }
    }
  }
  const ids = [...contracts]
  const archived = []
  for (let i = 0; i < ids.length; i += 100) {
    const result = await server.getLedgerEntries(...ids.slice(i, i + 100).map(instanceKey))
    for (const entry of result.entries) {
      if (entry.liveUntilLedgerSeq < result.latestLedger) {
        archived.push(Address.fromScAddress(entry.key.contractData.contract).toString())
      }
    }
  }
  return archived
}

const archived = await findArchivedContracts()
console.log(`   found ${archived.length}`)

let automatic = false
search: for (const contractId of archived) {
  for (const getter of ['decimals', 'name', 'symbol', 'version', 'admin', 'get_admin', 'owner']) {
    const transaction = await call(contractId, getter)
    if (!(await sdk.needsRestore(transaction))) continue
    signatures = 0
    const result = await sdk.submitWithRestore({ transaction, wallet })
    // Large contracts can cost more to restore than the default fee cap.
    if (result.errorCode === 'RESTORE_FEE_CAP_EXCEEDED') continue search
    assert.ok(result.success, result.error)
    assert.equal(result.restoreMode, 'automatic')
    assert.equal(signatures, 1)
    const after = await liveUntil(contractId)
    assert.ok(after.liveUntil > after.latestLedger, 'entry should be live after the call')
    automatic = true
    break search
  }
}

let explicit = false
for (const contractId of archived) {
  const before = await liveUntil(contractId)
  if (before.liveUntil >= before.latestLedger) continue
  const result = await sdk.restoreKeys([instanceKey(contractId)], wallet)
  assert.ok(result.success, result.error)
  const after = await liveUntil(contractId)
  assert.ok(after.liveUntil > after.latestLedger, 'entry should be live after restoreKeys')
  explicit = true
  break
}

const status = (ran) => (ran ? 'ok' : 'SKIPPED (no suitable archived contract found)')
console.log(`4. automatic restore: ${status(automatic)}`)
console.log(`5. explicit restore:  ${status(explicit)}`)
if (process.env.REQUIRE_ARCHIVED === '1') {
  assert.ok(automatic && explicit, 'both restore paths must be exercised')
}
