/**
 * Tests for multisig restore support (#240).
 *
 * Covers:
 * 1. A restore tx is only returned once threshold signing weight is
 *    collected; under-signed transactions throw.
 * 2. Signers are prompted in parallel by default, sequentially on request.
 * 3. Weighted thresholds are evaluated correctly.
 * 4. Duplicate signatures are merged once.
 * 5. verifyThreshold as a pre-submit guard.
 *
 * Mock signers are backed by real `Keypair`s so signature merging exercises
 * the real `@stellar/stellar-sdk` envelope code.
 */

import { describe, it, expect, vi } from 'vitest'
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk'
import type { WalletAdapter } from '../types.js'
import { MultiSigWalletAdapter, type MultiSigSigner } from '../MultiSigWalletAdapter.js'

const NP = Networks.TESTNET

function buildUnsignedTx(sourcePk: string): string {
  const account = new Account(sourcePk, '1')
  return new TransactionBuilder(account, { fee: '100', networkPassphrase: NP })
    .addOperation(Operation.restoreFootprint({}))
    .setTimeout(120)
    .build()
    .toEnvelope()
    .toXDR('base64')
}

/** A single-sig wallet backed by `kp`. If `sign` is false it returns the tx untouched. */
function mockSigner(kp: Keypair, opts: { sign?: boolean; delayMs?: number } = {}): WalletAdapter {
  const { sign = true, delayMs = 0 } = opts
  return {
    isConnected: vi.fn().mockResolvedValue(true),
    getPublicKey: vi.fn().mockResolvedValue(kp.publicKey()),
    signTransaction: vi
      .fn()
      .mockImplementation(async (xdr: string, o?: { networkPassphrase?: string }) => {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
        if (!sign) return xdr
        const tx = TransactionBuilder.fromXDR(xdr, o?.networkPassphrase ?? NP)
        tx.sign(kp)
        return tx.toEnvelope().toXDR('base64')
      }),
  }
}

describe('MultiSigWalletAdapter', () => {
  it('rejects invalid configuration', () => {
    expect(
      () => new MultiSigWalletAdapter({ signers: [], threshold: 1, networkPassphrase: NP }),
    ).toThrow(/at least one signer/)
    expect(
      () =>
        new MultiSigWalletAdapter({
          signers: [{ adapter: mockSigner(Keypair.random()) }],
          threshold: 0,
          networkPassphrase: NP,
        }),
    ).toThrow(/threshold must be/)
  })

  it('returns a merged envelope once threshold weight is collected (2-of-3)', async () => {
    const kps = [Keypair.random(), Keypair.random(), Keypair.random()]
    const source = Keypair.random()
    const adapter = new MultiSigWalletAdapter({
      signers: kps.map((kp) => ({ adapter: mockSigner(kp) })),
      threshold: 2,
      networkPassphrase: NP,
    })

    const signedXdr = await adapter.signTransaction(buildUnsignedTx(source.publicKey()))
    const tx = TransactionBuilder.fromXDR(signedXdr, NP)

    expect(tx.signatures).toHaveLength(3)
    expect(await adapter.verifyThreshold(signedXdr)).toBe(true)
  })

  it('throws when collected weight is below threshold', async () => {
    const signingKp = Keypair.random()
    const rejectingKp = Keypair.random()
    const adapter = new MultiSigWalletAdapter({
      signers: [
        { adapter: mockSigner(signingKp) },
        { adapter: mockSigner(rejectingKp, { sign: false }) }, // returns tx unsigned
      ],
      threshold: 2,
      networkPassphrase: NP,
    })

    await expect(
      adapter.signTransaction(buildUnsignedTx(Keypair.random().publicKey())),
    ).rejects.toThrow(/below the required threshold 2/)
  })

  it('prompts signers in parallel by default', async () => {
    const started: number[] = []
    let resolvedCount = 0
    const makeTracked = (kp: Keypair, idx: number): MultiSigSigner => ({
      adapter: {
        isConnected: vi.fn().mockResolvedValue(true),
        getPublicKey: vi.fn().mockResolvedValue(kp.publicKey()),
        signTransaction: vi.fn().mockImplementation(async (xdr: string) => {
          started.push(idx)
          await new Promise((r) => setTimeout(r, 20))
          resolvedCount += 1
          const tx = TransactionBuilder.fromXDR(xdr, NP)
          tx.sign(kp)
          return tx.toEnvelope().toXDR('base64')
        }),
      },
    })

    const adapter = new MultiSigWalletAdapter({
      signers: [
        makeTracked(Keypair.random(), 0),
        makeTracked(Keypair.random(), 1),
        makeTracked(Keypair.random(), 2),
      ],
      threshold: 3,
      networkPassphrase: NP,
    })

    const promise = adapter.signTransaction(buildUnsignedTx(Keypair.random().publicKey()))
    // All three should have started before any resolves.
    await new Promise((r) => setTimeout(r, 5))
    expect(started).toEqual([0, 1, 2])
    expect(resolvedCount).toBe(0)
    await promise
  })

  it('prompts signers sequentially when parallel is false', async () => {
    const events: string[] = []
    const makeTracked = (kp: Keypair, name: string): MultiSigSigner => ({
      adapter: {
        isConnected: vi.fn().mockResolvedValue(true),
        getPublicKey: vi.fn().mockResolvedValue(kp.publicKey()),
        signTransaction: vi.fn().mockImplementation(async (xdr: string) => {
          events.push(`start:${name}`)
          await new Promise((r) => setTimeout(r, 10))
          events.push(`end:${name}`)
          const tx = TransactionBuilder.fromXDR(xdr, NP)
          tx.sign(kp)
          return tx.toEnvelope().toXDR('base64')
        }),
      },
    })

    const adapter = new MultiSigWalletAdapter({
      signers: [makeTracked(Keypair.random(), 'a'), makeTracked(Keypair.random(), 'b')],
      threshold: 2,
      networkPassphrase: NP,
      parallel: false,
    })

    await adapter.signTransaction(buildUnsignedTx(Keypair.random().publicKey()))
    expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])
  })

  it('evaluates weighted thresholds using per-signer weight', async () => {
    const heavy = Keypair.random()
    const light = Keypair.random()
    const abstaining = Keypair.random()

    const adapter = new MultiSigWalletAdapter({
      signers: [
        { adapter: mockSigner(heavy), weight: 2 },
        { adapter: mockSigner(light), weight: 1 },
        { adapter: mockSigner(abstaining, { sign: false }), weight: 1 },
      ],
      threshold: 3,
      networkPassphrase: NP,
    })

    const result = await adapter.collectSignatures(buildUnsignedTx(Keypair.random().publicKey()))
    expect(result.weight).toBe(3) // 2 (heavy) + 1 (light); abstaining adds nothing
    expect(result.signerCount).toBe(2)
    expect(result.thresholdMet).toBe(true)
  })

  it('merges a duplicate signature only once', async () => {
    const kp = Keypair.random()
    const adapter = new MultiSigWalletAdapter({
      signers: [
        { adapter: mockSigner(kp), weight: 1 },
        { adapter: mockSigner(kp), weight: 1 }, // same key signs again
      ],
      threshold: 1,
      networkPassphrase: NP,
    })

    const result = await adapter.collectSignatures(buildUnsignedTx(Keypair.random().publicKey()))
    const tx = TransactionBuilder.fromXDR(result.signedXdr, NP)
    expect(tx.signatures).toHaveLength(1)
    expect(result.signerCount).toBe(1)
    expect(result.weight).toBe(1)
  })

  it('verifyThreshold returns false for an under-signed envelope', async () => {
    const kps = [Keypair.random(), Keypair.random(), Keypair.random()]
    const adapter = new MultiSigWalletAdapter({
      signers: kps.map((kp) => ({ adapter: mockSigner(kp) })),
      threshold: 3,
      networkPassphrase: NP,
    })

    // Only the first signer signs.
    const unsigned = buildUnsignedTx(Keypair.random().publicKey())
    const partial = TransactionBuilder.fromXDR(unsigned, NP)
    partial.sign(kps[0])
    expect(await adapter.verifyThreshold(partial.toEnvelope().toXDR('base64'))).toBe(false)
  })
})
