/**
 * Tests for branded-types.ts
 *
 * Covers:
 * 1. Each `as*` cast helper returns a value that satisfies the corresponding
 *    branded type (runtime value is unchanged).
 * 2. Each `is*` type-guard correctly identifies valid and invalid inputs,
 *    including edge-cases (empty string, null, undefined, wrong types, wrong
 *    lengths, invalid characters, etc.).
 * 3. Demonstrates that distinct branded types are not interchangeable at the
 *    TypeScript level — validated via `@ts-expect-error` annotations.
 */

import { describe, it, expect } from 'vitest'
import {
  // Cast helpers
  asTxHash,
  asContractIdHex,
  asStellarPublicKey,
  asXdrBase64,
  asHexString,
  asNetworkPassphrase,
  asRpcUrl,
  asFeeStroops,
  asSequenceNumber,
  asHistoryEntryId,
  // Type guards
  isTxHash,
  isContractIdHex,
  isStellarPublicKey,
  isXdrBase64,
  isHexString,
  isNetworkPassphrase,
  isRpcUrl,
  isFeeStroops,
  isSequenceNumber,
  isHistoryEntryId,
  // Types (used for @ts-expect-error tests)
  type TxHash,
  type ContractIdHex,
  type XdrBase64,
  type StellarPublicKey,
  type HexString,
  type NetworkPassphrase,
  type RpcUrl,
  type FeeStroops,
  type SequenceNumber,
  type HistoryEntryId,
} from '../branded-types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A realistic 64-char lowercase hex string (32 zero bytes). */
const VALID_HEX_64 = '0'.repeat(64)

/** A realistic Stellar G-address (strkey-encoded ED25519 public key, 56 chars). */
const VALID_G_ADDRESS = 'GCBFEKAZZN4UA66VKFPFDT7JJF2B3WZMEPG536YUQW7YYXYNYBWVRZT6'

/** A well-formed base64 string (multiple of 4, valid alphabet). */
const VALID_BASE64 = 'AAAAAAAA'

// ---------------------------------------------------------------------------
// TxHash
// ---------------------------------------------------------------------------

describe('TxHash', () => {
  describe('asTxHash', () => {
    it('returns the same string value at runtime', () => {
      const raw = VALID_HEX_64
      const hash = asTxHash(raw)
      expect(hash).toBe(raw)
    })

    it('does not alter the string in any way', () => {
      const raw = 'a1b2c3d4e5f6' + '0'.repeat(52)
      expect(asTxHash(raw)).toBe(raw)
    })
  })

  describe('isTxHash', () => {
    it('accepts a valid 64-char lowercase hex string', () => {
      expect(isTxHash(VALID_HEX_64)).toBe(true)
    })

    it('accepts a 64-char lowercase hex string with mixed hex digits', () => {
      const mixed = 'abcdef0123456789'.repeat(4) // exactly 64 chars
      expect(isTxHash(mixed)).toBe(true)
    })

    it('rejects uppercase hex (Stellar SDK returns lowercase)', () => {
      expect(isTxHash('A'.repeat(64))).toBe(false)
    })

    it('rejects a string that is too short', () => {
      expect(isTxHash('0'.repeat(63))).toBe(false)
    })

    it('rejects a string that is too long', () => {
      expect(isTxHash('0'.repeat(65))).toBe(false)
    })

    it('rejects non-hex characters', () => {
      expect(isTxHash('g'.repeat(64))).toBe(false)
      expect(isTxHash('x'.repeat(64))).toBe(false)
    })

    it('rejects an empty string', () => {
      expect(isTxHash('')).toBe(false)
    })

    it('rejects null', () => {
      expect(isTxHash(null)).toBe(false)
    })

    it('rejects undefined', () => {
      expect(isTxHash(undefined)).toBe(false)
    })

    it('rejects a number', () => {
      expect(isTxHash(12345)).toBe(false)
    })

    it('rejects a base64 string of the same approximate length', () => {
      // base64 contains + / = which are not valid hex
      expect(isTxHash('AAAA+AAA/AAAA=AA' + '0'.repeat(48))).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// ContractIdHex
// ---------------------------------------------------------------------------

describe('ContractIdHex', () => {
  describe('asContractIdHex', () => {
    it('returns the same string value at runtime', () => {
      expect(asContractIdHex(VALID_HEX_64)).toBe(VALID_HEX_64)
    })
  })

  describe('isContractIdHex', () => {
    it('accepts a valid 64-char lowercase hex string', () => {
      expect(isContractIdHex(VALID_HEX_64)).toBe(true)
    })

    it('rejects uppercase hex', () => {
      expect(isContractIdHex('F'.repeat(64))).toBe(false)
    })

    it('rejects wrong length (shorter)', () => {
      expect(isContractIdHex('0'.repeat(62))).toBe(false)
    })

    it('rejects wrong length (longer)', () => {
      expect(isContractIdHex('0'.repeat(66))).toBe(false)
    })

    it('rejects a Stellar G-address (different encoding entirely)', () => {
      expect(isContractIdHex(VALID_G_ADDRESS)).toBe(false)
    })

    it('rejects null and undefined', () => {
      expect(isContractIdHex(null)).toBe(false)
      expect(isContractIdHex(undefined)).toBe(false)
    })

    it('rejects an empty string', () => {
      expect(isContractIdHex('')).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// StellarPublicKey
// ---------------------------------------------------------------------------

describe('StellarPublicKey', () => {
  describe('asStellarPublicKey', () => {
    it('returns the same string value at runtime', () => {
      expect(asStellarPublicKey(VALID_G_ADDRESS)).toBe(VALID_G_ADDRESS)
    })
  })

  describe('isStellarPublicKey', () => {
    it('accepts a valid G-address', () => {
      expect(isStellarPublicKey(VALID_G_ADDRESS)).toBe(true)
    })

    it('rejects a string not starting with G', () => {
      expect(isStellarPublicKey('SAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN')).toBe(false)
    })

    it('rejects a 64-char hex string (different type)', () => {
      expect(isStellarPublicKey(VALID_HEX_64)).toBe(false)
    })

    it('rejects an address that is too short', () => {
      expect(isStellarPublicKey('G' + 'A'.repeat(54))).toBe(false)
    })

    it('rejects an address that is too long', () => {
      expect(isStellarPublicKey('G' + 'A'.repeat(56))).toBe(false)
    })

    it('rejects lowercase characters in the base32 payload', () => {
      expect(isStellarPublicKey('G' + 'a'.repeat(55))).toBe(false)
    })

    it('rejects null and undefined', () => {
      expect(isStellarPublicKey(null)).toBe(false)
      expect(isStellarPublicKey(undefined)).toBe(false)
    })

    it('rejects an empty string', () => {
      expect(isStellarPublicKey('')).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// XdrBase64
// ---------------------------------------------------------------------------

describe('XdrBase64', () => {
  describe('asXdrBase64', () => {
    it('returns the same string value at runtime', () => {
      expect(asXdrBase64(VALID_BASE64)).toBe(VALID_BASE64)
    })
  })

  describe('isXdrBase64', () => {
    it('accepts a valid unpadded base64 string (multiple of 4)', () => {
      expect(isXdrBase64('AAAA')).toBe(true)
    })

    it('accepts a base64 string with single padding character', () => {
      expect(isXdrBase64('AAAB')).toBe(true) // no padding needed here
      expect(isXdrBase64('AAA=')).toBe(true)
    })

    it('accepts a base64 string with double padding characters', () => {
      expect(isXdrBase64('AA==')).toBe(true)
    })

    it('accepts a longer valid base64 string', () => {
      // Typical ledger key base64 (36+ bytes → 48+ base64 chars)
      expect(isXdrBase64('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'+'AAAA')).toBe(true)
    })

    it('accepts base64 containing + and /', () => {
      expect(isXdrBase64('AB+/')).toBe(true)
    })

    it('rejects a string whose length is not a multiple of 4', () => {
      expect(isXdrBase64('AAA')).toBe(false)
      expect(isXdrBase64('AAAAA')).toBe(false)
    })

    it('rejects strings with invalid base64 characters', () => {
      expect(isXdrBase64('AA@=')).toBe(false)
      expect(isXdrBase64('AA!=')).toBe(false)
    })

    it('does not accept a hex string that contains characters outside the base64 alphabet', () => {
      // A hex string containing only 0-9a-f is a subset of the base64 alphabet,
      // so a 64-char hex string IS structurally valid base64 — these types overlap
      // at the string level; the distinction is semantic, not structural.
      // We verify that a string with clearly non-base64 chars (e.g. spaces, colons)
      // is correctly rejected.
      expect(isXdrBase64('dead:beef cafe')).toBe(false)
      // A hex string that is NOT a multiple of 4 in length is rejected
      expect(isXdrBase64('0'.repeat(63))).toBe(false)
    })

    it('rejects an empty string', () => {
      expect(isXdrBase64('')).toBe(false)
    })

    it('rejects null and undefined', () => {
      expect(isXdrBase64(null)).toBe(false)
      expect(isXdrBase64(undefined)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// HexString
// ---------------------------------------------------------------------------

describe('HexString', () => {
  describe('asHexString', () => {
    it('returns the same string value at runtime', () => {
      expect(asHexString('deadbeef')).toBe('deadbeef')
    })
  })

  describe('isHexString', () => {
    it('accepts a valid lowercase hex string', () => {
      expect(isHexString('deadbeef')).toBe(true)
    })

    it('accepts a 64-char hex string', () => {
      expect(isHexString(VALID_HEX_64)).toBe(true)
    })

    it('rejects uppercase hex', () => {
      expect(isHexString('DEADBEEF')).toBe(false)
    })

    it('rejects a string with odd length (incomplete byte)', () => {
      expect(isHexString('abc')).toBe(false)
    })

    it('rejects non-hex characters', () => {
      expect(isHexString('gg')).toBe(false)
    })

    it('rejects an empty string', () => {
      expect(isHexString('')).toBe(false)
    })

    it('rejects null and undefined', () => {
      expect(isHexString(null)).toBe(false)
      expect(isHexString(undefined)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// NetworkPassphrase
// ---------------------------------------------------------------------------

describe('NetworkPassphrase', () => {
  const TESTNET = 'Test SDF Network ; September 2015'
  const MAINNET = 'Public Global Stellar Network ; September 2015'

  describe('asNetworkPassphrase', () => {
    it('returns the same string value at runtime', () => {
      expect(asNetworkPassphrase(TESTNET)).toBe(TESTNET)
    })
  })

  describe('isNetworkPassphrase', () => {
    it('accepts the standard testnet passphrase', () => {
      expect(isNetworkPassphrase(TESTNET)).toBe(true)
    })

    it('accepts the mainnet passphrase', () => {
      expect(isNetworkPassphrase(MAINNET)).toBe(true)
    })

    it('accepts a custom private network passphrase', () => {
      expect(isNetworkPassphrase('My Private Network ; 2024')).toBe(true)
    })

    it('rejects an empty string', () => {
      expect(isNetworkPassphrase('')).toBe(false)
    })

    it('rejects null and undefined', () => {
      expect(isNetworkPassphrase(null)).toBe(false)
      expect(isNetworkPassphrase(undefined)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// RpcUrl
// ---------------------------------------------------------------------------

describe('RpcUrl', () => {
  describe('asRpcUrl', () => {
    it('returns the same string value at runtime', () => {
      const url = 'https://soroban-testnet.stellar.org'
      expect(asRpcUrl(url)).toBe(url)
    })
  })

  describe('isRpcUrl', () => {
    it('accepts an https URL', () => {
      expect(isRpcUrl('https://soroban-testnet.stellar.org')).toBe(true)
    })

    it('accepts an http URL (e.g. local dev node)', () => {
      expect(isRpcUrl('http://localhost:8000/soroban/rpc')).toBe(true)
    })

    it('rejects a string without a URL scheme', () => {
      expect(isRpcUrl('soroban-testnet.stellar.org')).toBe(false)
    })

    it('rejects a network passphrase string', () => {
      expect(isRpcUrl('Test SDF Network ; September 2015')).toBe(false)
    })

    it('rejects an empty string', () => {
      expect(isRpcUrl('')).toBe(false)
    })

    it('rejects null and undefined', () => {
      expect(isRpcUrl(null)).toBe(false)
      expect(isRpcUrl(undefined)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// FeeStroops
// ---------------------------------------------------------------------------

describe('FeeStroops', () => {
  describe('asFeeStroops', () => {
    it('returns the same string value at runtime', () => {
      expect(asFeeStroops('100')).toBe('100')
    })
  })

  describe('isFeeStroops', () => {
    it('accepts "100"', () => {
      expect(isFeeStroops('100')).toBe(true)
    })

    it('accepts "0"', () => {
      expect(isFeeStroops('0')).toBe(true)
    })

    it('accepts a large fee value', () => {
      expect(isFeeStroops('10000000')).toBe(true)
    })

    it('rejects a negative number string', () => {
      expect(isFeeStroops('-100')).toBe(false)
    })

    it('rejects a decimal string', () => {
      expect(isFeeStroops('100.5')).toBe(false)
    })

    it('rejects an empty string', () => {
      expect(isFeeStroops('')).toBe(false)
    })

    it('rejects null and undefined', () => {
      expect(isFeeStroops(null)).toBe(false)
      expect(isFeeStroops(undefined)).toBe(false)
    })

    it('rejects non-numeric strings', () => {
      expect(isFeeStroops('abc')).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// SequenceNumber
// ---------------------------------------------------------------------------

describe('SequenceNumber', () => {
  describe('asSequenceNumber', () => {
    it('returns the same string value at runtime', () => {
      expect(asSequenceNumber('1234567890')).toBe('1234567890')
    })
  })

  describe('isSequenceNumber', () => {
    it('accepts a valid decimal sequence number', () => {
      expect(isSequenceNumber('1234567890')).toBe(true)
    })

    it('accepts "0"', () => {
      expect(isSequenceNumber('0')).toBe(true)
    })

    it('accepts a very large sequence number string', () => {
      // 64-bit max = 18446744073709551615
      expect(isSequenceNumber('18446744073709551615')).toBe(true)
    })

    it('rejects a negative sequence number', () => {
      expect(isSequenceNumber('-1')).toBe(false)
    })

    it('rejects a float', () => {
      expect(isSequenceNumber('1.5')).toBe(false)
    })

    it('rejects an empty string', () => {
      expect(isSequenceNumber('')).toBe(false)
    })

    it('rejects null and undefined', () => {
      expect(isSequenceNumber(null)).toBe(false)
      expect(isSequenceNumber(undefined)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// HistoryEntryId
// ---------------------------------------------------------------------------

describe('HistoryEntryId', () => {
  describe('asHistoryEntryId', () => {
    it('returns the same string value at runtime', () => {
      const id = 'lf4rxkz0-abc123'
      expect(asHistoryEntryId(id)).toBe(id)
    })
  })

  describe('isHistoryEntryId', () => {
    it('accepts a valid base36-timestamp-suffix id', () => {
      expect(isHistoryEntryId('lf4rxkz0-abc123')).toBe(true)
    })

    it('accepts ids with all digits', () => {
      expect(isHistoryEntryId('12345678-987654')).toBe(true)
    })

    it('rejects an id without a hyphen', () => {
      expect(isHistoryEntryId('lf4rxkz0abc123')).toBe(false)
    })

    it('rejects an id with uppercase characters', () => {
      expect(isHistoryEntryId('LF4RXKZ0-ABC123')).toBe(false)
    })

    it('rejects an id with multiple hyphens', () => {
      // The format is exactly two segments separated by one hyphen
      expect(isHistoryEntryId('lf4-rxk-abc')).toBe(false)
    })

    it('rejects an empty string', () => {
      expect(isHistoryEntryId('')).toBe(false)
    })

    it('rejects a transaction hash (wrong format)', () => {
      expect(isHistoryEntryId(VALID_HEX_64)).toBe(false)
    })

    it('rejects null and undefined', () => {
      expect(isHistoryEntryId(null)).toBe(false)
      expect(isHistoryEntryId(undefined)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Cross-type distinguishability (compile-time enforcement)
//
// These tests use @ts-expect-error to prove that distinct branded types
// cannot be silently mixed up. The test itself just asserts identity so it
// always passes at runtime — the value of these lines is in the TypeScript
// compilation step catching the misuse.
// ---------------------------------------------------------------------------

describe('branded type compile-time distinguishability', () => {
  it('TxHash and ContractIdHex are not interchangeable', () => {
    const hash: TxHash = asTxHash(VALID_HEX_64)
    // @ts-expect-error — TxHash is not assignable to ContractIdHex
    const _contractId: ContractIdHex = hash
    expect(hash).toBe(VALID_HEX_64)
  })

  it('TxHash and XdrBase64 are not interchangeable', () => {
    const hash: TxHash = asTxHash(VALID_HEX_64)
    // @ts-expect-error — TxHash is not assignable to XdrBase64
    const _xdr: XdrBase64 = hash
    expect(hash).toBe(VALID_HEX_64)
  })

  it('XdrBase64 and HexString are not interchangeable', () => {
    const xdr: XdrBase64 = asXdrBase64(VALID_BASE64)
    // @ts-expect-error — XdrBase64 is not assignable to HexString
    const _hex: HexString = xdr
    expect(xdr).toBe(VALID_BASE64)
  })

  it('StellarPublicKey and TxHash are not interchangeable', () => {
    const key: StellarPublicKey = asStellarPublicKey(VALID_G_ADDRESS)
    // @ts-expect-error — StellarPublicKey is not assignable to TxHash
    const _hash: TxHash = key
    expect(key).toBe(VALID_G_ADDRESS)
  })

  it('NetworkPassphrase and RpcUrl are not interchangeable', () => {
    const passphrase: NetworkPassphrase = asNetworkPassphrase('Test SDF Network ; September 2015')
    // @ts-expect-error — NetworkPassphrase is not assignable to RpcUrl
    const _url: RpcUrl = passphrase
    expect(typeof passphrase).toBe('string')
  })

  it('FeeStroops and SequenceNumber are not interchangeable', () => {
    const fee: FeeStroops = asFeeStroops('100')
    // @ts-expect-error — FeeStroops is not assignable to SequenceNumber
    const _seq: SequenceNumber = fee
    expect(fee).toBe('100')
  })

  it('HistoryEntryId is not assignable to plain string without cast', () => {
    const id: HistoryEntryId = asHistoryEntryId('lf4rxkz0-abc123')
    // Branded types ARE assignable to their base type (string) — this is intentional
    // and makes them easy to use with existing APIs without explicit unwrapping.
    const raw: string = id
    expect(raw).toBe('lf4rxkz0-abc123')
  })
})

// ---------------------------------------------------------------------------
// Type-guard narrowing (runtime behaviour)
// ---------------------------------------------------------------------------

describe('type-guard narrowing', () => {
  it('isTxHash narrows unknown to TxHash inside the if-block', () => {
    const raw: unknown = VALID_HEX_64
    if (isTxHash(raw)) {
      // TypeScript should narrow `raw` to `TxHash` here.
      // We verify that the runtime value is usable as a string.
      expect(raw.length).toBe(64)
    } else {
      // Should not reach here for a valid hash
      expect.fail('isTxHash should have returned true')
    }
  })

  it('isXdrBase64 narrows unknown to XdrBase64', () => {
    const raw: unknown = VALID_BASE64
    if (isXdrBase64(raw)) {
      expect(raw.length % 4).toBe(0)
    } else {
      expect.fail('isXdrBase64 should have returned true')
    }
  })

  it('isContractIdHex narrows unknown to ContractIdHex', () => {
    const raw: unknown = VALID_HEX_64
    if (isContractIdHex(raw)) {
      expect(raw.length).toBe(64)
    } else {
      expect.fail('isContractIdHex should have returned true')
    }
  })

  it('isStellarPublicKey narrows unknown to StellarPublicKey', () => {
    const raw: unknown = VALID_G_ADDRESS
    if (isStellarPublicKey(raw)) {
      expect(raw[0]).toBe('G')
    } else {
      expect.fail('isStellarPublicKey should have returned true')
    }
  })
})

// ---------------------------------------------------------------------------
// Exhaustive helper coverage (#301)
// ---------------------------------------------------------------------------

/** Every exported `as*` / `is*` pair, with one valid sample per brand. */
const HELPERS = [
  { name: 'TxHash', as: asTxHash, is: isTxHash, valid: VALID_HEX_64 },
  { name: 'ContractIdHex', as: asContractIdHex, is: isContractIdHex, valid: VALID_HEX_64 },
  {
    name: 'StellarPublicKey',
    as: asStellarPublicKey,
    is: isStellarPublicKey,
    valid: VALID_G_ADDRESS,
  },
  { name: 'XdrBase64', as: asXdrBase64, is: isXdrBase64, valid: VALID_BASE64 },
  { name: 'HexString', as: asHexString, is: isHexString, valid: 'deadbeef' },
  {
    name: 'NetworkPassphrase',
    as: asNetworkPassphrase,
    is: isNetworkPassphrase,
    valid: 'Test SDF Network ; September 2015',
  },
  { name: 'RpcUrl', as: asRpcUrl, is: isRpcUrl, valid: 'https://soroban-testnet.stellar.org' },
  { name: 'FeeStroops', as: asFeeStroops, is: isFeeStroops, valid: '100' },
  { name: 'SequenceNumber', as: asSequenceNumber, is: isSequenceNumber, valid: '123456789' },
  { name: 'HistoryEntryId', as: asHistoryEntryId, is: isHistoryEntryId, valid: 'lz1k3x9c-4f7g2h' },
] as const

const NON_STRING_VALUES: unknown[] = [
  null,
  undefined,
  0,
  123,
  Number.NaN,
  true,
  false,
  {},
  [],
  ['deadbeef'],
  () => 'deadbeef',
  Symbol('x'),
  10n,
]

describe('all branded helpers', () => {
  it('covers all 10 brands (20 helpers)', () => {
    expect(HELPERS).toHaveLength(10)
    expect(new Set(HELPERS.map((h) => h.name)).size).toBe(10)
  })

  describe.each(HELPERS)('$name', ({ as, is, valid }) => {
    it('is* accepts the canonical valid sample', () => {
      expect(is(valid)).toBe(true)
    })

    it('as* returns the identical runtime value for a valid input', () => {
      expect(as(valid)).toBe(valid)
      expect(typeof as(valid)).toBe('string')
    })

    it('is* rejects the empty string', () => {
      expect(is('')).toBe(false)
    })

    // Wrapped in tuples so it.each does not spread array values into arguments.
    it.each(NON_STRING_VALUES.map((v) => [v]))('is* rejects the non-string value %s', (value) => {
      expect(is(value)).toBe(false)
    })

    it('is* rejects a boxed String object even when its content is valid', () => {
      expect(is(new String(valid))).toBe(false)
    })

    // as* helpers are unchecked, zero-cost casts: they never validate and
    // never throw. Validation belongs to the paired is* guard at trust
    // boundaries — these tests pin that contract so a silent change to
    // throwing behaviour is caught.
    it('as* does not throw or alter malformed input (unchecked cast)', () => {
      for (const bad of ['', ' ', 'not valid!', `${valid} `, '\n']) {
        expect(() => as(bad)).not.toThrow()
        expect(as(bad)).toBe(bad)
      }
    })

    it('as* is idempotent', () => {
      expect(as(as(valid))).toBe(valid)
    })
  })

  it('the is-then-as pattern yields a descriptive error for invalid input', () => {
    function parseTxHash(raw: unknown): TxHash {
      if (!isTxHash(raw)) throw new Error(`Invalid transaction hash: ${String(raw)}`)
      return asTxHash(raw)
    }

    expect(parseTxHash(VALID_HEX_64)).toBe(VALID_HEX_64)
    expect(() => parseTxHash('xyz')).toThrow('Invalid transaction hash: xyz')
    expect(() => parseTxHash(undefined)).toThrow(/Invalid transaction hash/)
  })
})

describe('boundary inputs', () => {
  describe('isTxHash / isContractIdHex (64 lowercase hex chars)', () => {
    const guards = [
      ['isTxHash', isTxHash],
      ['isContractIdHex', isContractIdHex],
    ] as const

    it.each(guards)('%s rejects 63 and 65 characters', (_, guard) => {
      expect(guard('a'.repeat(63))).toBe(false)
      expect(guard('a'.repeat(65))).toBe(false)
    })

    it.each(guards)('%s accepts every lowercase hex digit', (_, guard) => {
      expect(guard('0123456789abcdef'.repeat(4))).toBe(true)
    })

    it.each(guards)('%s rejects a 0x prefix', (_, guard) => {
      expect(guard(`0x${'a'.repeat(62)}`)).toBe(false)
    })

    it.each(guards)('%s rejects surrounding whitespace and newlines', (_, guard) => {
      expect(guard(` ${VALID_HEX_64}`)).toBe(false)
      expect(guard(`${VALID_HEX_64} `)).toBe(false)
      expect(guard(`${VALID_HEX_64}\n`)).toBe(false)
    })

    it.each(guards)('%s rejects a single uppercase character', (_, guard) => {
      expect(guard(`${'a'.repeat(63)}A`)).toBe(false)
    })
  })

  describe('isStellarPublicKey', () => {
    it('accepts any 56-char G + base32 string (checksum is not verified)', () => {
      expect(isStellarPublicKey(`G${'A'.repeat(55)}`)).toBe(true)
    })

    it('rejects 55 and 57 characters', () => {
      expect(isStellarPublicKey(`G${'A'.repeat(54)}`)).toBe(false)
      expect(isStellarPublicKey(`G${'A'.repeat(56)}`)).toBe(false)
    })

    it('rejects secret seeds (S...), contract addresses (C...), and muxed accounts (M...)', () => {
      expect(isStellarPublicKey(`S${VALID_G_ADDRESS.slice(1)}`)).toBe(false)
      expect(isStellarPublicKey(`C${VALID_G_ADDRESS.slice(1)}`)).toBe(false)
      expect(isStellarPublicKey(`M${VALID_G_ADDRESS.slice(1)}`)).toBe(false)
    })

    it.each(['0', '1', '8', '9'])('rejects the non-base32 digit "%s"', (digit) => {
      expect(isStellarPublicKey(`G${digit}${'A'.repeat(54)}`)).toBe(false)
    })

    it('rejects a lowercase g prefix and surrounding whitespace', () => {
      expect(isStellarPublicKey(`g${VALID_G_ADDRESS.slice(1)}`)).toBe(false)
      expect(isStellarPublicKey(` ${VALID_G_ADDRESS}`)).toBe(false)
      expect(isStellarPublicKey(`${VALID_G_ADDRESS}\n`)).toBe(false)
    })
  })

  describe('isXdrBase64', () => {
    it.each(['AAAA', 'AAA=', 'AA==', 'ab+/', 'Zm9vYmFy'])('accepts "%s"', (value) => {
      expect(isXdrBase64(value)).toBe(true)
    })

    it.each([
      ['a lone padding character', '='],
      ['only padding', '===='],
      ['three padding characters', 'A==='],
      ['padding before data', '=AAA'],
      ['padding in the middle', 'AA=A'],
      ['length 1', 'A'],
      ['length 5', 'AAAAA'],
      ['URL-safe alphabet (-)', 'AB-C'],
      ['URL-safe alphabet (_)', 'AB_C'],
      ['embedded whitespace', 'AA AA==='],
      ['a trailing newline', 'AAAA\n'],
      ['non-ASCII characters', 'AAé='],
    ])('rejects malformed base64: %s', (_, value) => {
      expect(isXdrBase64(value)).toBe(false)
    })
  })

  describe('isHexString', () => {
    it('accepts the shortest valid value (one byte)', () => {
      expect(isHexString('00')).toBe(true)
    })

    it.each([
      ['odd length 1', 'a'],
      ['odd length 3', 'abc'],
      ['a 0x prefix', '0x00'],
      ['uppercase digits', 'AB'],
      ['non-hex letters', 'zz'],
      ['embedded whitespace', 'ab cd'],
    ])('rejects %s', (_, value) => {
      expect(isHexString(value)).toBe(false)
    })
  })

  describe('isNetworkPassphrase', () => {
    it('accepts any non-empty string, including whitespace-only', () => {
      expect(isNetworkPassphrase(' ')).toBe(true)
      expect(isNetworkPassphrase('x')).toBe(true)
    })
  })

  describe('isRpcUrl', () => {
    it('accepts a minimal http(s) URL', () => {
      expect(isRpcUrl('http://x')).toBe(true)
      expect(isRpcUrl('https://localhost:8000/soroban/rpc')).toBe(true)
    })

    it.each([
      ['a scheme with no host', 'https://'],
      ['an uppercase scheme', 'HTTPS://example.com'],
      ['a websocket scheme', 'wss://example.com'],
      ['an ftp scheme', 'ftp://example.com'],
      ['a leading space', ' https://example.com'],
      ['a missing slash', 'https:/example.com'],
    ])('rejects %s', (_, value) => {
      expect(isRpcUrl(value)).toBe(false)
    })
  })

  describe('isFeeStroops / isSequenceNumber (unsigned decimal integers)', () => {
    const guards = [
      ['isFeeStroops', isFeeStroops],
      ['isSequenceNumber', isSequenceNumber],
    ] as const

    it.each(guards)('%s accepts values beyond Number.MAX_SAFE_INTEGER', (_, guard) => {
      expect(guard('9007199254740993')).toBe(true)
      expect(guard('340282366920938463463374607431768211455')).toBe(true)
    })

    it.each(guards)('%s accepts leading zeros', (_, guard) => {
      expect(guard('007')).toBe(true)
    })

    it.each(guards)('%s rejects non-canonical numeric forms', (_, guard) => {
      for (const value of ['+1', '1e3', '0x10', '1_000', '1,000', ' 1', '1 ', '1\n', 'Infinity']) {
        expect(guard(value), value).toBe(false)
      }
    })
  })

  describe('isHistoryEntryId', () => {
    it('accepts single-character segments', () => {
      expect(isHistoryEntryId('a-b')).toBe(true)
    })

    it.each([
      ['a missing suffix', 'abc-'],
      ['a missing prefix', '-abc'],
      ['a lone hyphen', '-'],
      ['an underscore separator', 'abc_def'],
      ['a non-alphanumeric character', 'ab!-cd'],
      ['surrounding whitespace', ' abc-def'],
    ])('rejects %s', (_, value) => {
      expect(isHistoryEntryId(value)).toBe(false)
    })
  })
})
