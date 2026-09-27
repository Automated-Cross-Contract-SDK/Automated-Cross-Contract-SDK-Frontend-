import { SorobanResurrectConfig } from '../SorobanResurrectConfig';

describe('SorobanResurrectConfig', () => {
  const validConfig = {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
  };

  describe('constructor validation', () => {
    it('accepts a valid config', () => {
      expect(() => new SorobanResurrectConfig(validConfig)).not.toThrow();
    });

    const invalidCases: Array<{
      field: string;
      config: Record<string, unknown>;
      expected: RegExp;
    }> = [
      {
        field: 'rpcUrl',
        config: { ...validConfig, rpcUrl: '' },
        expected: /Invalid rpcUrl: .* Must be a non-empty string/,
      },
      {
        field: 'rpcUrl',
        config: { ...validConfig, rpcUrl: 42 },
        expected: /Invalid rpcUrl: .* Must be a non-empty string/,
      },
      {
        field: 'networkPassphrase',
        config: { ...validConfig, networkPassphrase: '' },
        expected: /Invalid networkPassphrase: .* Must be a non-empty string/,
      },
      {
        field: 'networkPassphrase',
        config: { ...validConfig, networkPassphrase: null },
        expected: /Invalid networkPassphrase: .* Must be a non-empty string/,
      },
      {
        field: 'contractId',
        config: { ...validConfig, contractId: '' },
        expected: /Invalid contractId: .* Must be a non-empty string/,
      },
      {
        field: 'contractId',
        config: { ...validConfig, contractId: undefined },
        expected: /Invalid contractId: .* Must be a non-empty string/,
      },
    ];

    it.each(invalidCases)('rejects invalid $field', ({ config, expected }) => {
      expect(() => new SorobanResurrectConfig(config as never)).toThrow(expected);
    });
  });

  describe('switchNetwork validation', () => {
    it('applies the same validation as the constructor', () => {
      const instance = new SorobanResurrectConfig(validConfig);
      expect(() => instance.switchNetwork({ rpcUrl: '' })).toThrow(
        /Invalid rpcUrl: .* Must be a non-empty string/,
      );
    });

    it('accepts a valid partial update', () => {
      const instance = new SorobanResurrectConfig(validConfig);
      expect(() =>
        instance.switchNetwork({ rpcUrl: 'https://soroban-futurenet.stellar.org' }),
      ).not.toThrow();
    });
  });
});
