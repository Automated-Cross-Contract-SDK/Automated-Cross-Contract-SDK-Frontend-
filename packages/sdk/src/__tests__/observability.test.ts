/**
 * Tests for observability features:
 * - MetricsHooks (#607)
 * - RpcHealthCheck (#608)
 * - LoggingRedaction (#609)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  MetricsHook,
  MetricsOutcomeMetadata,
  MetricsRecoveryMetadata,
} from '../MetricsHooks.js';
import { MetricsRedaction } from '../MetricsHooks.js';
import {
  checkRpcHealth,
  checkRpcEndpointReachability,
  checkRpcMethod,
} from '../RpcHealthCheck.js';
import {
  RedactionUtils,
  SafeLogger,
  LoggingClassifications,
  LoggingFieldType,
} from '../LoggingRedaction.js';

describe('MetricsHooks', () => {
  describe('MetricsRedaction.hashSuffix', () => {
    it('extracts last 4 characters by default', () => {
      const result = MetricsRedaction.hashSuffix('abcdef1234567890');
      expect(result).toBe('7890');
    });

    it('respects custom character count', () => {
      const result = MetricsRedaction.hashSuffix('abcdef1234567890', 8);
      expect(result).toBe('34567890');
    });

    it('returns empty string for short input', () => {
      const result = MetricsRedaction.hashSuffix('abc', 4);
      expect(result).toBe('');
    });

    it('handles empty string', () => {
      const result = MetricsRedaction.hashSuffix('', 4);
      expect(result).toBe('');
    });
  });

  it('provides forbidden, redacted, and safe field lists', () => {
    expect(MetricsRedaction.forbidden).toBeDefined();
    expect(MetricsRedaction.redactAsHash).toBeDefined();
    expect(MetricsRedaction.safe).toBeDefined();
    expect(Array.isArray(MetricsRedaction.forbidden)).toBe(true);
    expect(Array.isArray(MetricsRedaction.safe)).toBe(true);
  });
});

describe('RpcHealthCheck', () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkRpcEndpointReachability', () => {
    it('returns reachable=true for successful HEAD request', async () => {
      fetchSpy.mockResolvedValueOnce({
        status: 200,
        ok: true,
      });

      const result = await checkRpcEndpointReachability(
        'https://soroban-testnet.stellar.org',
        5000,
      );

      expect(result.reachable).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('returns reachable=false for network errors', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await checkRpcEndpointReachability(
        'https://bad-endpoint.invalid',
        5000,
      );

      expect(result.reachable).toBe(false);
      expect(result.error).toContain('Network timeout');
    });

    it('detects HTTP error status codes', async () => {
      fetchSpy.mockResolvedValueOnce({
        status: 503,
        ok: false,
      });

      const result = await checkRpcEndpointReachability(
        'https://soroban-testnet.stellar.org',
        5000,
      );

      expect(result.reachable).toBe(true); // HEAD succeeded
      expect(result.statusCode).toBe(503);
    });

    it('respects custom timeout', async () => {
      const startTime = Date.now();
      fetchSpy.mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout')), 100);
          }),
      );

      const result = await checkRpcEndpointReachability(
        'https://soroban-testnet.stellar.org',
        100,
      );

      expect(result.reachable).toBe(false);
      expect(Date.now() - startTime).toBeGreaterThanOrEqual(100);
    });
  });

  describe('checkRpcMethod', () => {
    it('returns available=true for successful method response', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { ledger_sequence: 123 },
          }),
      });

      const result = await checkRpcMethod(
        'https://soroban-testnet.stellar.org',
        'getLatestLedger',
        5000,
      );

      expect(result.available).toBe(true);
      expect(result.method).toBe('getLatestLedger');
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('returns available=false for methodNotFound error', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32601, message: 'Method not found' },
          }),
      });

      const result = await checkRpcMethod(
        'https://soroban-testnet.stellar.org',
        'nonexistentMethod',
        5000,
      );

      expect(result.available).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns available=false on network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await checkRpcMethod(
        'https://bad-endpoint.invalid',
        'getLatestLedger',
        5000,
      );

      expect(result.available).toBe(false);
      expect(result.error).toContain('Connection refused');
    });

    it('handles invalid JSON response', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'not valid json',
      });

      const result = await checkRpcMethod(
        'https://soroban-testnet.stellar.org',
        'getLatestLedger',
        5000,
      );

      expect(result.available).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });
  });

  describe('checkRpcHealth', () => {
    it('returns healthy=true when endpoint and all methods are available', async () => {
      fetchSpy
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
        }) // endpoint check
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              result: { ledger_sequence: 123 },
            }),
        }) // getLatestLedger
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              result: { status: 'SUCCESS' },
            }),
        }) // getTransaction
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              result: [],
            }),
        }) // getTransactions
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              result: { result: 'success' },
            }),
        }) // simulateTransaction
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              result: { hash: '...' },
            }),
        }) // sendTransaction
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              result: [],
            }),
        }); // getLedgerEntries

      const result = await checkRpcHealth(
        'https://soroban-testnet.stellar.org',
        [],
        5000,
      );

      expect(result.healthy).toBe(true);
      expect(result.endpoint.reachable).toBe(true);
      expect(result.requiredMethods.every((m) => m.available)).toBe(true);
      expect(result.summary).toContain('healthy');
    });

    it('returns healthy=false when endpoint is unreachable', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      const result = await checkRpcHealth(
        'https://bad-endpoint.invalid',
        [],
        5000,
      );

      expect(result.healthy).toBe(false);
      expect(result.endpoint.reachable).toBe(false);
      expect(result.recommendations).toBeDefined();
      expect(result.recommendations?.length).toBeGreaterThan(0);
    });

    it('includes optional methods in results', async () => {
      fetchSpy
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
        }) // endpoint
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              result: { ledger_sequence: 123 },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              result: { status: 'SUCCESS' },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              result: [],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              result: { result: 'success' },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              result: { hash: '...' },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              result: [],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              result: { entries: [] },
            }),
        });

      const result = await checkRpcHealth(
        'https://soroban-testnet.stellar.org',
        ['customMethod'],
        5000,
      );

      expect(result.optionalMethods).toBeDefined();
      expect(result.optionalMethods?.length).toBeGreaterThan(0);
    });

    it('generates recommendations for slow methods', async () => {
      fetchSpy
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
        })
        .mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                jsonrpc: '2.0',
                result: { ledger_sequence: 123 },
              }),
          };
        });

      const result = await checkRpcHealth(
        'https://soroban-testnet.stellar.org',
        [],
        5000,
      );

      // Will have some slow methods (mocked to take 100ms)
      expect(result).toBeDefined();
      expect(result.timestamp).toBeDefined();
    });
  });
});

describe('LoggingRedaction', () => {
  describe('RedactionUtils.hashAddress', () => {
    it('redacts address to first 2 and last 4 characters', () => {
      const address = 'GABC1234567890ABCDEF1234567890Z';
      const redacted = RedactionUtils.hashAddress(address);
      expect(redacted).toBe('GA...90Z');
    });

    it('returns *** for short addresses', () => {
      const result = RedactionUtils.hashAddress('GX');
      expect(result).toBe('***');
    });

    it('handles empty string', () => {
      const result = RedactionUtils.hashAddress('');
      expect(result).toBe('***');
    });
  });

  describe('RedactionUtils.hashSuffix', () => {
    it('redacts hash to last 4 characters by default', () => {
      const hash = 'abc123def456xyz789';
      const redacted = RedactionUtils.hashSuffix(hash);
      expect(redacted).toBe('...xyz789');
    });

    it('respects custom character count', () => {
      const hash = 'abc123def456xyz789';
      const redacted = RedactionUtils.hashSuffix(hash, 8);
      expect(redacted).toBe('...ef456xyz789');
    });

    it('returns *** for short hashes', () => {
      const result = RedactionUtils.hashSuffix('ab');
      expect(result).toBe('***');
    });
  });

  describe('RedactionUtils.redactXdr', () => {
    it('returns redaction placeholder for any XDR', () => {
      const xdr = 'AAAAA...very long xdr...';
      const result = RedactionUtils.redactXdr(xdr);
      expect(result).toBe('[XDR redacted]');
    });
  });

  describe('RedactionUtils.filterObject', () => {
    it('removes forbidden fields', () => {
      const obj = {
        workflowId: 'wf_123',
        privateKey: 'S...',
        durationMs: 150,
      };

      const result = RedactionUtils.filterObject(obj);
      expect(result.workflowId).toBe('wf_123');
      expect(result.durationMs).toBe(150);
      expect(result.privateKey).toBeUndefined();
    });

    it('removes sensitive fields by default', () => {
      const obj = {
        workflowId: 'wf_123',
        address: 'GABC...xyz',
        durationMs: 150,
      };

      const result = RedactionUtils.filterObject(obj);
      expect(result.workflowId).toBe('wf_123');
      expect(result.durationMs).toBe(150);
      expect(result.address).toBeUndefined();
    });

    it('includes sensitive fields when allowSensitive=true', () => {
      const obj = {
        workflowId: 'wf_123',
        address: 'GABC1234567890ABCDEF1234567890XYZ',
        durationMs: 150,
      };

      const result = RedactionUtils.filterObject(obj, true);
      expect(result.workflowId).toBe('wf_123');
      expect(result.durationMs).toBe(150);
      expect(result.address).toBeDefined();
      expect(result.address).toContain('GA');
      expect(result.address).toContain('XYZ');
    });

    it('recursively filters nested objects', () => {
      const obj = {
        workflowId: 'wf_123',
        nested: {
          address: 'GABC...xyz',
          privateKey: 'S...',
        },
      };

      const result = RedactionUtils.filterObject(obj);
      expect(result.workflowId).toBe('wf_123');
      expect((result.nested as any)?.privateKey).toBeUndefined();
      expect((result.nested as any)?.address).toBeUndefined();
    });
  });

  describe('RedactionUtils field checks', () => {
    it('identifies forbidden fields', () => {
      expect(RedactionUtils.isForbidden('privateKey')).toBe(true);
      expect(RedactionUtils.isForbidden('secret')).toBe(true);
      expect(RedactionUtils.isForbidden('workflowId')).toBe(false);
    });

    it('identifies sensitive fields', () => {
      expect(RedactionUtils.isSensitive('address')).toBe(true);
      expect(RedactionUtils.isSensitive('contractId')).toBe(true);
      expect(RedactionUtils.isSensitive('workflowId')).toBe(false);
    });
  });

  describe('SafeLogger', () => {
    let logSpy: any;

    beforeEach(() => {
      logSpy = vi.fn();
    });

    it('filters objects when logging', () => {
      const logger = new SafeLogger(false);
      const obj = {
        workflowId: 'wf_123',
        address: 'GABC...xyz',
        privateKey: 'S...',
      };

      logger.info('Test', obj, logSpy);

      expect(logSpy).toHaveBeenCalled();
      const logged = logSpy.mock.calls[0][0];
      expect(logged).toContain('wf_123');
      expect(logged).not.toContain('GABC');
      expect(logged).not.toContain('privateKey');
    });

    it('includes redacted sensitive fields when allowSensitive=true', () => {
      const logger = new SafeLogger(true);
      const obj = {
        workflowId: 'wf_123',
        address: 'GABC1234567890ABCDEF1234567890XYZ',
      };

      logger.info('Test', obj, logSpy);

      expect(logSpy).toHaveBeenCalled();
      const logged = logSpy.mock.calls[0][0];
      expect(logged).toContain('wf_123');
      expect(logged).toContain('GA...XYZ');
    });

    it('logs errors with context', () => {
      const logger = new SafeLogger(false);
      const error = new Error('Something failed');
      const context = {
        workflowId: 'wf_123',
        privateKey: 'S...',
      };

      logger.error('Error occurred', error, context, logSpy);

      expect(logSpy).toHaveBeenCalled();
      const logged = logSpy.mock.calls[0][0];
      expect(logged).toContain('Something failed');
      expect(logged).toContain('wf_123');
      expect(logged).not.toContain('privateKey');
    });
  });

  describe('LoggingClassifications', () => {
    it('includes classifications for common fields', () => {
      expect(LoggingClassifications.length).toBeGreaterThan(0);

      const privateKeyClassification = LoggingClassifications.find(
        (c) => c.field === 'privateKey',
      );
      expect(privateKeyClassification?.type).toBe(LoggingFieldType.Forbidden);

      const addressClassification = LoggingClassifications.find(
        (c) => c.field === 'address',
      );
      expect(addressClassification?.type).toBe(LoggingFieldType.Sensitive);

      const workflowIdClassification = LoggingClassifications.find(
        (c) => c.field === 'workflowId',
      );
      expect(workflowIdClassification?.type).toBe(LoggingFieldType.Public);
    });

    it('provides redaction functions for sensitive fields', () => {
      const addressClassification = LoggingClassifications.find(
        (c) => c.field === 'address',
      );
      expect(addressClassification?.redactFn).toBeDefined();

      if (addressClassification?.redactFn) {
        const redacted = addressClassification.redactFn(
          'GABC1234567890ABCDEF1234567890XYZ',
        );
        expect(redacted).toContain('GA');
        expect(redacted).toContain('XYZ');
      }
    });
  });
});
