/**
 * Lightweight debug logging for internal SDK operations, modelled on the
 * `debug` npm package but with no dependencies and no bundle cost when
 * logging is off.
 *
 * Logging is disabled unless a filter is set:
 * - Node: the `DEBUG` environment variable (`DEBUG=soroban-resurrect:* node app.js`)
 * - Browser: `localStorage.debug` (`localStorage.debug = 'soroban-resurrect:*'`)
 *
 * The filter is a comma or space separated list of namespace patterns. `*`
 * matches any run of characters, and a `-` prefix excludes a namespace, so
 * `soroban-resurrect:*,-soroban-resurrect:cache` enables everything except
 * the cache namespace.
 */

/** Namespace prefix shared by every debug logger in the SDK. */
export const DEBUG_NAMESPACE_PREFIX = 'soroban-resurrect'

/**
 * A namespaced debug logger. Formats and writes to the console only when its
 * namespace is enabled by the active filter, and is a no-op otherwise.
 */
export interface Debugger {
  (message: string, ...args: unknown[]): void
  /** The logger's full namespace, e.g. `soroban-resurrect:archiver`. */
  readonly namespace: string
  /** Whether the namespace is currently enabled by the active filter. */
  readonly enabled: boolean
}

// === Filter resolution

/** Reads DEBUG from the environment, tolerating browsers with no `process`. */
function readEnvFilter(): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return proc?.env?.DEBUG
}

/** Reads `localStorage.debug`, tolerating storage access throwing in sandboxed frames. */
function readStorageFilter(): string | undefined {
  try {
    const storage = (globalThis as { localStorage?: { getItem(key: string): string | null } })
      .localStorage
    return storage?.getItem('debug') ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Returns the active debug filter string, or `undefined` when logging is off.
 *
 * @returns The `DEBUG` env var if present, otherwise `localStorage.debug`.
 */
export function getDebugFilter(): string | undefined {
  const filter = readEnvFilter() ?? readStorageFilter()
  return filter && filter.length > 0 ? filter : undefined
}

/** Converts one `*`-wildcard pattern into an anchored regular expression. */
function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

/**
 * Tests a namespace against a filter string.
 *
 * @param namespace - Full namespace to test, e.g. `soroban-resurrect:executor`.
 * @param filter - Filter string in `DEBUG` syntax. `undefined` disables everything.
 * @returns `true` if the namespace matches an include pattern and no exclude pattern.
 */
export function isNamespaceEnabled(namespace: string, filter: string | undefined): boolean {
  if (!filter) {
    return false
  }

  let included = false

  for (const raw of filter.split(/[\s,]+/)) {
    if (raw.length === 0) {
      continue
    }
    if (raw.startsWith('-')) {
      // An exclude match wins outright, regardless of include order
      if (patternToRegExp(raw.slice(1)).test(namespace)) {
        return false
      }
    } else if (patternToRegExp(raw).test(namespace)) {
      included = true
    }
  }

  return included
}

// === Logger factory

/**
 * Creates a namespaced debug logger for an internal SDK operation.
 *
 * The filter is resolved once per logger, at creation time, so changing
 * `DEBUG` after the SDK has loaded has no effect.
 *
 * @param scope - Short scope name appended to the SDK prefix, e.g. `archiver`.
 *   Pass a namespace that already starts with the prefix to use it verbatim.
 * @returns A {@link Debugger} that logs to `console.debug` when enabled.
 *
 * @example
 * ```ts
 * const debug = createDebugger('archiver')
 * debug('detecting archived keys for %d ledger keys', keys.length)
 * ```
 */
export function createDebugger(scope: string): Debugger {
  const namespace = scope.startsWith(`${DEBUG_NAMESPACE_PREFIX}:`)
    ? scope
    : `${DEBUG_NAMESPACE_PREFIX}:${scope}`
  const enabled = isNamespaceEnabled(namespace, getDebugFilter())

  const log = (message: string, ...args: unknown[]): void => {
    if (!enabled) {
      return
    }
    console.debug(`${new Date().toISOString()} ${namespace} ${message}`, ...args)
  }

  return Object.defineProperties(log, {
    namespace: { value: namespace, enumerable: true },
    enabled: { value: enabled, enumerable: true },
  }) as Debugger
}
