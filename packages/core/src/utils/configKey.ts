/**
 * Fields on a SorobanResurrect config that require a brand new SDK instance
 * when they change. Everything else (callbacks, nested memo objects, an
 * injected `rpcClient`, etc.) is considered "cold": a new but logically equal
 * value must NOT recreate the SDK or reset workflow state.
 */
const HOT_CONFIG_KEYS = ['rpcUrl', 'networkPassphrase'] as const;

/**
 * Build a stable, serialization-safe key for a config object.
 *
 * Unlike `JSON.stringify(config)`, this helper:
 * - only looks at the fields that actually require a new instance,
 * - never throws on nested objects, `rpcClient` instances, or functions,
 * - returns the same key for equal-but-newly-created config objects.
 *
 * Use it as the change guard and as the `useEffect` dependency in the React,
 * Vue, and Svelte hooks so all three share identical semantics.
 */
export function configKey(config: unknown): string {
  if (config === null || typeof config !== 'object') {
    return '';
  }

  const source = config as Record<string, unknown>;
  const parts: string[] = [];

  for (const key of HOT_CONFIG_KEYS) {
    const value = source[key];
    if (value === undefined) {
      continue;
    }
    parts.push(`${key}=${typeof value === 'string' ? value : String(value)}`);
  }

  return parts.join('|');
}
