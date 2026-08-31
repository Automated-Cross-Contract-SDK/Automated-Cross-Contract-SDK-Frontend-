import { describe, it, expect, vi } from 'vitest'
import {
  WalletConnectAdapter,
  passphraseToChainId,
  parseStellarAccount,
  STELLAR_WC_CHAINS,
  STELLAR_WC_METHODS,
  type WalletConnectSessionLike,
} from '../index.js'

const TESTNET = 'Test SDF Network ; September 2015'
const PUBNET = 'Public Global Stellar Network ; September 2015'
const ADDR = 'G*****************************************************'

function makeSession(overrides: Partial<WalletConnectSessionLike> = {}): WalletConnectSessionLike {
  return {
    topic: 'topic-123',
    namespaces: {
      stellar: {
        accounts: [`${STELLAR_WC_CHAINS.testnet}:${ADDR}`],
        methods: [STELLAR_WC_METHODS.signXDR],
        events: [],
      },
    },
    ...overrides,
  }
}

describe('helpers', () => {
  it('maps passphrases to CAIP-2 chain ids', () => {
    expect(passphraseToChainId(TESTNET)).toBe(STELLAR_WC_CHAINS.testnet)
    expect(passphraseToChainId(PUBNET)).toBe(STELLAR_WC_CHAINS.public)
    expect(passphraseToChainId(undefined)).toBe(STELLAR_WC_CHAINS.testnet)
  })

  it('parses CAIP-10 stellar accounts', () => {
    expect(parseStellarAccount(`stellar:testnet:${ADDR}`)).toEqual({
      chainId: 'stellar:testnet',
      address: ADDR,
    })
    expect(() => parseStellarAccount('eip155:1:0xabc')).toThrow(/malformed/)
  })
})

describe('WalletConnectAdapter', () => {
  it('exposes the account granted by the session', async () => {
    const client = { request: vi.fn() }
    const wallet = new WalletConnectAdapter({
      client,
      session: makeSession(),
      networkPassphrase: TESTNET,
    })
    expect(await wallet.isConnected()).toBe(true)
    expect(await wallet.getPublicKey()).toBe(ADDR)
  })

  it('rejects a session whose accounts are on the wrong network', () => {
    expect(
      () =>
        new WalletConnectAdapter({
          client: { request: vi.fn() },
          session: makeSession(),
          networkPassphrase: PUBNET,
        }),
    ).toThrow(/network passphrase mismatch/)
  })

  it('rejects a session missing the signXDR method', () => {
    const session = makeSession()
    session.namespaces.stellar.methods = []
    expect(
      () =>
        new WalletConnectAdapter({ client: { request: vi.fn() }, session, networkPassphrase: TESTNET }),
    ).toThrow(/stellar_signXDR/)
  })

  it('maps signTransaction to a stellar_signXDR request', async () => {
    const client = {
      request: vi.fn().mockResolvedValue({ signedXDR: 'AAAA-signed' }),
    }
    const wallet = new WalletConnectAdapter({
      client,
      session: makeSession(),
      networkPassphrase: TESTNET,
    })

    const signed = await wallet.signTransaction('AAAA-unsigned')

    expect(signed).toBe('AAAA-signed')
    expect(client.request).toHaveBeenCalledWith({
      topic: 'topic-123',
      chainId: STELLAR_WC_CHAINS.testnet,
      request: { method: STELLAR_WC_METHODS.signXDR, params: { xdr: 'AAAA-unsigned' } },
    })
  })

  it('normalizes relay errors', async () => {
    const client = { request: vi.fn().mockRejectedValue(new Error('user rejected')) }
    const wallet = new WalletConnectAdapter({
      client,
      session: makeSession(),
      networkPassphrase: TESTNET,
    })
    await expect(wallet.signTransaction('x')).rejects.toThrow('WalletConnect: user rejected')
  })
})
