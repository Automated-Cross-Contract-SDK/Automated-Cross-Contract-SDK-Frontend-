import { SorobanResurrectConfig } from '../SorobanResurrectConfig';
import defaults from './defaults.json';

/**
 * Resolves a partial {@link SorobanResurrectConfig} into a fully-populated
 * config where every public field is defined, applying documented defaults
 * and validating numeric / boolean / string shapes up front.
 */
export function resolveConfig(
  config: Partial<SorobanResurrectConfig> = {},
): SorobanResurrectConfig {
  const resolved: SorobanResurrectConfig = {
    ...defaults,
    ...config,
  } as SorobanResurrectConfig;

  validateConfig(resolved);

  return resolved;
}

function assertPositiveInteger(value: unknown, field: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Invalid config field "${field}": expected a positive integer, received ${JSON.stringify(
        value,
      )}`,
    );
  }
}

function assertNonNegativeInteger(value: unknown, field: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(
      `Invalid config field "${field}": expected a non-negative integer, received ${JSON.stringify(
        value,
      )}`,
    );
  }
}

function assertBoolean(value: unknown, field: string): void {
  if (typeof value !== 'boolean') {
    throw new Error(
      `Invalid config field "${field}": expected a boolean, received ${JSON.stringify(
        value,
      )}`,
    );
  }
}

function assertString(value: unknown, field: string): void {
  if (typeof value !== 'string') {
    throw new Error(
      `Invalid config field "${field}": expected a string, received ${JSON.stringify(
        value,
      )}`,
    );
  }
}

function validateConfig(config: SorobanResurrectConfig): void {
  assertPositiveInteger(config.archiveDetectionChunkSize, 'archiveDetectionChunkSize');
  assertPositiveInteger(config.archiveDetectionConcurrency, 'archiveDetectionConcurrency');
  assertNonNegativeInteger(config.maxRestoreFeeStroops, 'maxRestoreFeeStroops');
  assertPositiveInteger(config.rpcTimeoutMs, 'rpcTimeoutMs');
  assertNonNegativeInteger(config.rpcRetryCount, 'rpcRetryCount');
  assertNonNegativeInteger(config.rpcRetryBackoffMs, 'rpcRetryBackoffMs');
  assertPositiveInteger(config.rpcCircuitBreakerThreshold, 'rpcCircuitBreakerThreshold');
  assertNonNegativeInteger(config.rpcCircuitBreakerCooldownMs, 'rpcCircuitBreakerCooldownMs');
  assertPositiveInteger(config.ttlWatchIntervalMs, 'ttlWatchIntervalMs');
  assertNonNegativeInteger(config.ttlWatchThreshold, 'ttlWatchThreshold');
  assertBoolean(config.ttlWatchAutoExtend, 'ttlWatchAutoExtend');
  assertString(config.restoreTxMemo, 'restoreTxMemo');
  assertString(config.restoreTxMemoText, 'restoreTxMemoText');
  assertNonNegativeInteger(config.maxSequenceRetries, 'maxSequenceRetries');
}
