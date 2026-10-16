import type { SorobanResurrectConfig, SubmitWithRestoreOptions } from './types.js'
import { validateConfigShape } from './SorobanResurrectConfig.js'

const SUPPORTED_CONFIG_OVERRIDES = new Set([
  'pollIntervalMs',
  'pollTimeoutMs',
  'restoreFeeMultiplier',
  'maxRestoreFeeStroops',
  'maxSequenceRetries',
  'restoreTxMemo',
  'restoreTxMemoText',
])

/**
 * Configuration that may safely vary for one restore workflow without
 * changing the settings shared by the SDK instance.
 */
export type SubmitWithRestoreConfigOverrides = Partial<
  Pick<
    SorobanResurrectConfig,
    | 'pollIntervalMs'
    | 'pollTimeoutMs'
    | 'restoreFeeMultiplier'
    | 'maxRestoreFeeStroops'
    | 'maxSequenceRetries'
    | 'restoreTxMemo'
    | 'restoreTxMemoText'
  >
>

/**
 * Per-request restore options. Existing `SubmitWithRestoreOptions` fields stay
 * available; `configOverrides` only overrides the explicitly supported
 * workflow settings.
 */
export type SubmitWithRestoreRequestOptions = SubmitWithRestoreOptions & {
  configOverrides?: SubmitWithRestoreConfigOverrides
}

/**
 * Resolves and validates an immutable config snapshot for one workflow.
 * Legacy top-level memo options take precedence over nested config overrides.
 */
export function resolveSubmitConfig(
  config: SorobanResurrectConfig,
  options: Pick<
    SubmitWithRestoreRequestOptions,
    'configOverrides' | 'restoreTxMemo' | 'restoreTxMemoText'
  >,
): Readonly<SorobanResurrectConfig> {
  const suppliedOverrides: unknown = options.configOverrides
  if (
    suppliedOverrides !== undefined &&
    (typeof suppliedOverrides !== 'object' || suppliedOverrides === null || Array.isArray(suppliedOverrides))
  ) {
    throw new Error('Invalid configOverrides: expected an object.')
  }

  const overrides = (suppliedOverrides ?? {}) as SubmitWithRestoreConfigOverrides
  for (const field of Object.keys(overrides)) {
    if (!SUPPORTED_CONFIG_OVERRIDES.has(field)) {
      throw new Error(`Invalid configOverrides.${field}: this setting cannot be overridden per request.`)
    }
  }

  const effectiveConfig: SorobanResurrectConfig = {
    ...config,
    pollIntervalMs: overrides.pollIntervalMs === undefined ? config.pollIntervalMs : overrides.pollIntervalMs,
    pollTimeoutMs: overrides.pollTimeoutMs === undefined ? config.pollTimeoutMs : overrides.pollTimeoutMs,
    restoreFeeMultiplier:
      overrides.restoreFeeMultiplier === undefined
        ? config.restoreFeeMultiplier
        : overrides.restoreFeeMultiplier,
    maxRestoreFeeStroops:
      overrides.maxRestoreFeeStroops === undefined
        ? config.maxRestoreFeeStroops
        : overrides.maxRestoreFeeStroops,
    maxSequenceRetries:
      overrides.maxSequenceRetries === undefined
        ? config.maxSequenceRetries
        : overrides.maxSequenceRetries,
    restoreTxMemo:
      options.restoreTxMemo !== undefined
        ? options.restoreTxMemo
        : overrides.restoreTxMemo === undefined
          ? config.restoreTxMemo
          : overrides.restoreTxMemo,
    restoreTxMemoText:
      options.restoreTxMemoText !== undefined
        ? options.restoreTxMemoText
        : overrides.restoreTxMemoText === undefined
          ? config.restoreTxMemoText
          : overrides.restoreTxMemoText,
  }

  validateConfigShape(effectiveConfig)
  return Object.freeze(effectiveConfig)
}
