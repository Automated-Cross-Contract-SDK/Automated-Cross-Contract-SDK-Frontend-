/**
 * Property-based tests (fast-check) for SimulationCache.fingerprint and the
 * branded-type guards. A fixed seed keeps CI runs reproducible; override it
 * locally with FC_SEED=<n> to explore other inputs.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import fc from 'fast-check'
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  Address,
  StrKey,
  nativeToScVal,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk'
import { SimulationCache } from '../SimulationCache.js'
import {
  isTxHash,
  isContractIdHex,
  isStellarPublicKey,
  isXdrBase64,
  isHexString,
} from '../branded-types.js'

const SEED = Number(process.env.FC_SEED ?? 1337)

beforeAll(() => {
  fc.configureGlobal({ seed: SEED, numRuns: 100 })
})

const SOURCE = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey()
const DEST = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey()
const FIXED_CLOSE_TIME = 1_700_000_000

function buildTx(opts: {
  seq: string
  amount: string
  fee?: string
  timeout?: number
}): Transaction {
  return new TransactionBuilder(new Account(SOURCE, opts.seq), {
    fee: opts.fee ?? '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({ destination: DEST, asset: Asset.native(), amount: opts.amount }),
    )
    .setTimeout(opts.timeout ?? 30, FIXED_CLOSE_TIME)
    .build()
}

const seqArb = fc.bigInt({ min: 0n, max: 2n ** 62n }).map(String)
const amountArb = fc.integer({ min: 1, max: 1_000_000_000 }).map((n) => (n / 1e7).toFixed(7))

describe('SimulationCache.fingerprint (property-based)', () => {
  const cache = new SimulationCache()

  it('is stable for the same logical tx regardless of sequence number', () => {
    fc.assert(
      fc.property(seqArb, seqArb, amountArb, (seqA, seqB, amount) => {
        expect(cache.fingerprint(buildTx({ seq: seqA, amount }))).toBe(
          cache.fingerprint(buildTx({ seq: seqB, amount })),
        )
      }),
    )
  })

  it('is deterministic across repeated calls', () => {
    fc.assert(
      fc.property(seqArb, amountArb, (seq, amount) => {
        const tx = buildTx({ seq, amount })
        expect(cache.fingerprint(tx)).toBe(cache.fingerprint(tx))
      }),
    )
  })

  it('differs when the operations differ', () => {
    fc.assert(
      fc.property(seqArb, amountArb, amountArb, (seq, a, b) => {
        fc.pre(a !== b)
        expect(cache.fingerprint(buildTx({ seq, amount: a }))).not.toBe(
          cache.fingerprint(buildTx({ seq, amount: b })),
        )
      }),
    )
  })

  it('differs when the fee differs', () => {
    fc.assert(
      fc.property(
        amountArb,
        fc.integer({ min: 100, max: 100_000 }),
        fc.integer({ min: 100, max: 100_000 }),
        (amount, feeA, feeB) => {
          fc.pre(feeA !== feeB)
          expect(cache.fingerprint(buildTx({ seq: '1', amount, fee: String(feeA) }))).not.toBe(
            cache.fingerprint(buildTx({ seq: '1', amount, fee: String(feeB) })),
          )
        },
      ),
    )
  })
})

const lowerHex = '0123456789abcdef'.split('')
const hexCharArb = fc.constantFrom(...lowerHex)
const hex64Arb = fc.array(hexCharArb, { minLength: 64, maxLength: 64 }).map((a) => a.join(''))
const nonStringArb = fc.oneof(
  fc.integer(),
  fc.double(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.object(),
  fc.array(fc.anything()),
)

describe('branded-type guards (property-based)', () => {
  const guards = { isTxHash, isContractIdHex, isStellarPublicKey, isXdrBase64, isHexString }

  it.each(Object.entries(guards))('%s rejects every non-string value', (_name, guard) => {
    fc.assert(fc.property(nonStringArb, (v) => guard(v) === false))
  })

  it.each(Object.entries(guards))('%s is a pure function of its input', (_name, guard) => {
    fc.assert(fc.property(fc.string(), (s) => guard(s) === guard(s)))
  })

  it('isTxHash / isContractIdHex accept any 64-char lowercase hex', () => {
    fc.assert(
      fc.property(hex64Arb, (s) => {
        expect(isTxHash(s)).toBe(true)
        expect(isContractIdHex(s)).toBe(true)
      }),
    )
  })

  it('isTxHash / isContractIdHex reject wrong lengths', () => {
    fc.assert(
      fc.property(fc.array(hexCharArb, { maxLength: 200 }), (chars) => {
        fc.pre(chars.length !== 64)
        const s = chars.join('')
        expect(isTxHash(s)).toBe(false)
        expect(isContractIdHex(s)).toBe(false)
      }),
    )
  })

  it('isTxHash rejects uppercase hex containing at least one letter', () => {
    fc.assert(
      fc.property(hex64Arb, (s) => {
        fc.pre(/[a-f]/.test(s))
        expect(isTxHash(s.toUpperCase())).toBe(false)
      }),
    )
  })

  it('isStellarPublicKey accepts every real ed25519 G-address', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), (bytes) => {
        const pk = Keypair.fromRawEd25519Seed(Buffer.from(bytes)).publicKey()
        expect(isStellarPublicKey(pk)).toBe(true)
        expect(isStellarPublicKey(pk.slice(1))).toBe(false)
        expect(isStellarPublicKey(pk + 'A')).toBe(false)
      }),
    )
  })

  it('isXdrBase64 accepts any Buffer encoded as base64 (non-empty)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 256 }), (bytes) => {
        expect(isXdrBase64(Buffer.from(bytes).toString('base64'))).toBe(true)
      }),
    )
  })

  it('isXdrBase64 rejects strings whose length is not a multiple of 4', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (s) => {
        fc.pre(s.length % 4 !== 0)
        expect(isXdrBase64(s)).toBe(false)
      }),
    )
  })

  it('isHexString accepts even-length hex and rejects non-hex characters', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 64 }),
        fc.constantFrom('g', 'z', ' ', '-'),
        (bytes, bad) => {
          const hex = Buffer.from(bytes).toString('hex')
          if (hex.length > 0) expect(isHexString(hex)).toBe(true)
          expect(isHexString(hex + bad + '0')).toBe(false)
        },
      ),
    )
  })
})

const ledgerKeyArb = fc.oneof(
  fc
    .uint8Array({ minLength: 32, maxLength: 32 })
    .map((hash) =>
      xdr.LedgerKey.contractCode(
        new xdr.LedgerKeyContractCode({ hash: Buffer.from(hash) }),
      ),
    ),
  fc
    .record({
      contractId: fc.uint8Array({ minLength: 32, maxLength: 32 }),
      storageKey: fc.string({ minLength: 1, maxLength: 32 }),
      durability: fc.constantFrom(
        xdr.ContractDataDurability.persistent(),
        xdr.ContractDataDurability.temporary(),
      ),
    })
    .map(({ contractId, storageKey, durability }) =>
      xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: new Address(StrKey.encodeContract(Buffer.from(contractId))).toScAddress(),
          key: nativeToScVal(storageKey),
          durability,
        }),
      ),
    ),
)

function normalizeLedgerKey(keyXdr: string): string {
  return xdr.LedgerKey.fromXDR(keyXdr, 'base64').toXDR('base64')
}

describe('ledger-key XDR parsing and normalization (property-based)', () => {
  it('round-trips supported key types to deterministic canonical XDR', () => {
    fc.assert(
      fc.property(ledgerKeyArb, (key) => {
        const serialized = key.toXDR('base64')
        const parsed = xdr.LedgerKey.fromXDR(serialized, 'base64')

        expect(parsed.switch().name).toBe(key.switch().name)
        expect(normalizeLedgerKey(serialized)).toBe(serialized)
        expect(normalizeLedgerKey(normalizeLedgerKey(serialized))).toBe(serialized)
      }),
    )
  })

  it('rejects malformed XDR with an invalid ledger-key discriminant', () => {
    const malformedKeyArb = fc
      .uint8Array({ maxLength: 128 })
      .map((payload) =>
        Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.from(payload)]).toString(
          'base64',
        ),
      )

    fc.assert(
      fc.property(malformedKeyArb, (serialized) => {
        expect(() => xdr.LedgerKey.fromXDR(serialized, 'base64')).toThrow()
      }),
    )
  })
})
