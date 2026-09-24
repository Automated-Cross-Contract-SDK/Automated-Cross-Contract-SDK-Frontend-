/**
 * Namespaced debug logging, modelled on the `debug` npm package but with no
 * dependency. Logging is off unless it is switched on explicitly, so calls left
 * in the SDK cost nothing in production beyond an enabled-flag check.
 *
 * Enable it with the `DEBUG` environment variable in Node:
 *
 * ```bash
 * DEBUG=soroban-resurrect:* node script.js
 * DEBUG=soroban-resurrect:archiver node script.js
 * DEBUG=soroban-resurrect:*,-soroban-resurrect:cache node script.js
 * ```
 *
 * Or with `localStorage.debug` in a browser:
 *
 * ```js
 * localStorage.debug = 'soroban-resurrect:*'
 * ```
 */

/** Prefix shared by every namespace the SDK logs under. */
export const DEBUG_NAMESPACE_PREFIX = 'soroban-resurrect'

/**
 * A namespaced logger. Extra arguments are passed through to the underlying
 * `console` call, so objects stay inspectable rather than being stringified.
 */
export interface Debugger {
  (message: string, ...args: unknown[]): void
  /** The namespace this logger writes under, e.g. `soroban-resurrect:archiver`. */
  readonly namespace: string
  /** Whether the current filter enables this namespace. */
  readonly enabled: boolean
}

// === Filter parsing

interface DebugFilter {
  include: RegExp[]
  exclude: RegExp[]
}

let filter: DebugFilter = { include: [], exclude: [] }
let lastTimestamp: number | undefined

/**
 * Converts one `DEBUG` pattern into a regular expression. `*` matches any run
 * of characters; everything else is matched literally.
 */
function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*?')
  return new RegExp(`^${escaped}$`)
}

function parseFilter(spec: string | undefined): DebugFilter {
  const include: RegExp[] = []
  const exclude: RegExp[] = []

  if (!spec) {
    return { include, exclude }
  }

  for (const raw of spec.split(/[\s,]+/)) {
    if (!raw) continue
    if (raw.startsWith('-')) {
      exclude.push(patternToRegExp(raw.slice(1)))
    } else {
      include.push(patternToRegExp(raw))
    }
  }

  return { include, exclude }
}

/**
 * Reads the active filter spec from the environment. Node's `DEBUG` wins over
 * the browser's `localStorage.debug` when both somehow exist.
 */
function readFilterSpec(): string | undefined {
  if (typeof process !== 'undefined' && process.env?.DEBUG) {
    return process.env.DEBUG
  }

  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('debug') ?? undefined
    }
  } catch {
    // Access to localStorage throws in some sandboxed/private contexts.
  }

  return undefined
}

/**
 * Returns true if `namespace` passes the active filter. Exclusions are checked
 * first, so `soroban-resurrect:*,-soroban-resurrect:cache` behaves as expected.
 */
export function isDebugEnabled(namespace: string): boolean {
  if (filter.exclude.some((re) => re.test(namespace))) {
    return false
  }
  return filter.include.some((re) => re.test(namespace))
}

/**
 * Re-reads the filter from the environment. Call this after changing
 * `process.env.DEBUG` or `localStorage.debug` at runtime, and note that
 * loggers created earlier pick the new filter up on their next call.
 *
 * @param spec - Explicit filter spec to apply instead of reading the
 *   environment. Pass an empty string to disable all logging.
 */
export function refreshDebugFilter(spec?: string): void {
  filter = parseFilter(spec ?? readFilterSpec())
}

refreshDebugFilter()

// === Logger factory

/** Milliseconds since the previous debug line, formatted like `+12ms`. */
function elapsed(): string {
  const now = Date.now()
  const delta = lastTimestamp === undefined ? 0 : now - lastTimestamp
  lastTimestamp = now
  return `+${delta}ms`
}

/**
 * Creates a namespaced logger. The `soroban-resurrect:` prefix is added for
 * you, so `createDebugger('archiver')` logs under
 * `soroban-resurrect:archiver`.
 *
 * Pass a function for any argument that is expensive to compute — it is only
 * called when the namespace is enabled:
 *
 * ```ts
 * const debug = createDebugger('archiver')
 * debug('checking %d keys', keys.length)
 * ```
 *
 * @param namespace - Namespace suffix, or a full namespace already starting
 *   with `soroban-resurrect:`.
 * @returns A {@link Debugger} that writes to `console.debug` when enabled.
 */
export function createDebugger(namespace: string): Debugger {
  const fullNamespace = namespace.startsWith(`${DEBUG_NAMESPACE_PREFIX}:`)
    ? namespace
    : `${DEBUG_NAMESPACE_PREFIX}:${namespace}`

  const log = ((message: string, ...args: unknown[]): void => {
    // Checked per call rather than cached so a filter change at runtime,
    // for example in a test, takes effect without recreating the logger.
    if (!isDebugEnabled(fullNamespace)) return
    console.debug(`${fullNamespace} ${message} ${elapsed()}`, ...args)
  }) as {
    (message: string, ...args: unknown[]): void
    namespace: string
    enabled: boolean
  }

  Object.defineProperty(log, 'namespace', { value: fullNamespace, enumerable: true })
  Object.defineProperty(log, 'enabled', {
    get: () => isDebugEnabled(fullNamespace),
    enumerable: true,
  })

  return log as Debugger
}
