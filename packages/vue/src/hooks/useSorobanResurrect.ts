import { ref, shallowRef, watch, onScopeDispose, type Ref, type ShallowRef } from 'vue';
import {
  SorobanResurrect,
  type SorobanResurrectConfig,
  type RestoreEstimate,
  type RestoreResult,
  type RestoreStatus,
} from '@soroban-resurrect/core';

/**
 * Fields that require a brand new SDK instance when they change.
 *
 * Hot (recreate the SDK):
 *   - rpcUrl
 *   - networkPassphrase
 *   - rpcClient (identity of the client object)
 *
 * Cold (do NOT recreate the SDK):
 *   - restoreTxMemo and other nested/object options
 *   - function-valued options (callbacks, signers, etc.)
 *   - any other option that is read lazily by the SDK
 *
 * We deliberately avoid JSON.stringify here: it throws on circular structures
 * and function values, and it reports a change for equal-but-newly-created
 * objects (e.g. a fresh `restoreTxMemo` literal on every render), which would
 * needlessly recreate the SDK and reset workflow state.
 */
export function configKey(config: SorobanResurrectConfig): string {
  const rpcClient = (config as { rpcClient?: unknown }).rpcClient;
  const rpcClientId =
    rpcClient && (typeof rpcClient === 'object' || typeof rpcClient === 'function')
      ? getObjectId(rpcClient)
      : String(rpcClient);

  return [config.rpcUrl ?? '', config.networkPassphrase ?? '', rpcClientId].join('\u0000');
}

const objectIds = new WeakMap<object, number>();
let nextObjectId = 0;

function getObjectId(value: object): number {
  let id = objectIds.get(value);
  if (id === undefined) {
    id = ++nextObjectId;
    objectIds.set(value, id);
  }
  return id;
}

export interface UseSorobanResurrectOptions {
  /**
   * Automatically fetch a restore estimate whenever the config changes.
   * Defaults to `false`.
   */
  autoEstimate?: boolean;
}

export interface UseSorobanResurrectReturn {
  /** The current SDK instance. Recreated only when a hot config field changes. */
  sdk: ShallowRef<SorobanResurrect>;
  /** The latest restore estimate, if any. */
  estimate: Ref<RestoreEstimate | null>;
  /** The latest restore result, if any. */
  result: Ref<RestoreResult | null>;
  /** The current restore status. */
  status: Ref<RestoreStatus>;
  /** Whether a restore is currently in flight. */
  isRestoring: Ref<boolean>;
  /** Fetch a fresh restore estimate. */
  estimateRestore: () => Promise<RestoreEstimate>;
  /** Execute a restore. */
  restore: () => Promise<RestoreResult>;
  /** Reset workflow state. */
  reset: () => void;
}

/**
 * Vue composable wrapping {@link SorobanResurrect}.
 *
 * The SDK instance is only recreated when a hot config field changes
 * (`rpcUrl`, `networkPassphrase`, or the identity of `rpcClient`). Equal but
 * newly created config objects — including ones with nested objects or
 * function-valued options — keep the same instance and preserve workflow state.
 */
export function useSorobanResurrect(
  config: SorobanResurrectConfig | Ref<SorobanResurrectConfig>,
  options: UseSorobanResurrectOptions = {},
): UseSorobanResurrectReturn {
  const configRef: Ref<SorobanResurrectConfig> =
    typeof config === 'object' && config !== null && 'value' in config
      ? (config as Ref<SorobanResurrectConfig>)
      : ref(config as SorobanResurrectConfig);

  const sdk = shallowRef<SorobanResurrect>(new SorobanResurrect(configRef.value));
  const estimate = ref<RestoreEstimate | null>(null);
  const result = ref<RestoreResult | null>(null);
  const status = ref<RestoreStatus>('idle');
  const isRestoring = ref(false);

  let currentKey = configKey(configRef.value);

  watch(
    () => configKey(configRef.value),
    (key) => {
      if (key === currentKey) return;
      currentKey = key;
      sdk.value = new SorobanResurrect(configRef.value);
      estimate.value = null;
      result.value = null;
      status.value = 'idle';
      isRestoring.value = false;
      if (options.autoEstimate) {
        void estimateRestore();
      }
    },
  );

  async function estimateRestore(): Promise<RestoreEstimate> {
    status.value = 'estimating';
    try {
      const next = await sdk.value.estimateRestore();
      estimate.value = next;
      status.value = 'idle';
      return next;
    } catch (error) {
      status.value = 'error';
      throw error;
    }
  }

  async function restore(): Promise<RestoreResult> {
    isRestoring.value = true;
    status.value = 'restoring';
    try {
      const next = await sdk.value.restore();
      result.value = next;
      status.value = 'success';
      return next;
    } catch (error) {
      status.value = 'error';
      throw error;
    } finally {
      isRestoring.value = false;
    }
  }

  function reset(): void {
    estimate.value = null;
    result.value = null;
    status.value = 'idle';
    isRestoring.value = false;
  }

  onScopeDispose(() => {
    reset();
  });

  return {
    sdk,
    estimate,
    result,
    status,
    isRestoring,
    estimateRestore,
    restore,
    reset,
  };
}
