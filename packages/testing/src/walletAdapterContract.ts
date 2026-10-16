export type WalletAdapterContractTest = (name: string, test: () => void | Promise<void>) => void

export interface WalletAdapterContractOptions {
  createAdapter(): object
  publicKey: string
  transactionXdr: string
  signedXdr: string
  networkPassphrase?: string
  rejectSigning?: () => void
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function call(adapter: object, methodName: string, args: unknown[] = []): unknown {
  const method = (adapter as Record<string, unknown>)[methodName]
  assert(typeof method === 'function', `${methodName}() must be implemented`)
  return Reflect.apply(method, adapter, args)
}

/** Registers the behavioral checks every built-in wallet adapter must satisfy. */
export function registerWalletAdapterContract(
  test: WalletAdapterContractTest,
  options: WalletAdapterContractOptions,
): void {
  test('reports a boolean connection state', async () => {
    const connected = await call(options.createAdapter(), 'isConnected')
    assert(typeof connected === 'boolean', 'isConnected() must resolve to a boolean')
  })

  test('returns the active public key', async () => {
    const publicKey = await call(options.createAdapter(), 'getPublicKey')
    assert(publicKey === options.publicKey, 'getPublicKey() must return the active key')
  })

  test('connects and returns an account when the adapter exposes connect()', async () => {
    const adapter = options.createAdapter()
    if (typeof (adapter as Record<string, unknown>).connect !== 'function') return
    const publicKey = await call(adapter, 'connect')
    if (publicKey !== undefined) {
      assert(publicKey === options.publicKey, 'connect() must return the selected account')
    }
  })

  test('signs a transaction and returns signed XDR', async () => {
    const adapter = options.createAdapter()
    const signedXdr = await call(adapter, 'signTransaction', [
      options.transactionXdr,
      {
        networkPassphrase: options.networkPassphrase,
      },
    ])
    assert(signedXdr === options.signedXdr, 'signTransaction() must return the wallet result')
  })

  if (options.networkPassphrase) {
    test('reports the active network when the provider supports it', async () => {
      const adapter = options.createAdapter()
      if (typeof (adapter as Record<string, unknown>).getNetwork !== 'function') return
      assert(
        (await call(adapter, 'getNetwork')) === options.networkPassphrase,
        'getNetwork() must match the configured network passphrase',
      )
    })
  }

  if (options.rejectSigning) {
    test('normalizes signing cancellation as USER_REJECTED', async () => {
      const adapter = options.createAdapter()
      options.rejectSigning?.()
      try {
        await call(adapter, 'signTransaction', [
          options.transactionXdr,
          {
            networkPassphrase: options.networkPassphrase,
          },
        ])
      } catch (error) {
        assert(
          error !== null && typeof error === 'object' && 'code' in error,
          'signing errors must be coded',
        )
        assert(error.code === 'USER_REJECTED', 'cancellation must use USER_REJECTED')
        return
      }
      throw new Error('signTransaction() unexpectedly succeeded after cancellation')
    })
  }
}
