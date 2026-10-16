import { describe, expect, it } from 'vitest'
import { resolveConfig, validateConfigShape } from '../SorobanResurrectConfig.js'

describe('SorobanResurrectConfig', () => {
  const validConfig = {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
  }

  it('accepts a valid config', () => {
    expect(() => validateConfigShape(validConfig)).not.toThrow()
    expect(() => resolveConfig(validConfig)).not.toThrow()
  })

  it.each([
    {
      field: 'rpcUrl',
      config: { ...validConfig, rpcUrl: '' },
      expected: /config\.rpcUrl must be a non-empty string/,
    },
    {
      field: 'rpcUrl',
      config: { ...validConfig, rpcUrl: 'not a url' },
      expected: /config\.rpcUrl must be a valid URL/,
    },
    {
      field: 'networkPassphrase',
      config: { ...validConfig, networkPassphrase: '' },
      expected: /Invalid network passphrase/,
    },
  ])('rejects invalid $field', ({ config, expected }) => {
    expect(() => resolveConfig(config as never)).toThrow(expected)
  })

  it('keeps explicit logger configuration when resolving', () => {
    const logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }
    const resolved = resolveConfig({ ...validConfig, logger })
    expect(resolved.config.logger).toBe(logger)
  })
})
