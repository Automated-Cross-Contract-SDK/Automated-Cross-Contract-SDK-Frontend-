import type { History, HistoryItem } from "./types";

export interface HistoryPersistenceOptions {
  /**
   * Called when a persistence operation fails (write, quota, hydration).
   * Best-effort persistence never throws, but callers can observe failures here.
   */
  onError?: (error: unknown) => void;
}

export interface DetachOptions {
  /**
   * When true, flush any queued write before unsubscribing.
   * Defaults to true so the last mutation is not lost.
   */
  flush?: boolean;
}

export interface HistoryPersistence {
  detach(options?: DetachOptions): void;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "handsoff:history";

/**
 * Attach best-effort persistence to a history instance.
 *
 * Failures are reported through `onError` instead of being swallowed, and
 * `detach()` flushes any queued write before unsubscribing.
 */
export function attachHistoryPersistence(
  history: History,
  storage: StorageLike,
  options: HistoryPersistenceOptions = {},
): HistoryPersistence {
  const { onError } = options;

  const report = (error: unknown): void => {
    if (onError) {
      onError(error);
    }
  };

  let detached = false;
  let queued: HistoryItem[] | null = null;

  const write = (items: HistoryItem[]): void => {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (error) {
      report(error);
    }
  };

  const flush = (): void => {
    if (queued === null) {
      return;
    }
    const items = queued;
    queued = null;
    write(items);
  };

  // Hydrate existing history, reporting failures instead of swallowing them.
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const items = history.loadJSON(raw);
      history.replace(items);
    }
  } catch (error) {
    // A missing network passphrase makes loadJSON throw; surface a clear error.
    if (isMissingPassphraseError(error)) {
      report(
        new Error(
          "attachHistoryPersistence: cannot hydrate history without a networkPassphrase. " +
            "Provide a networkPassphrase when constructing the history instance.",
        ),
      );
    } else {
      report(error);
    }
  }

  const unsubscribe = history.subscribe((items) => {
    if (detached) {
      return;
    }
    queued = items;
    flush();
  });

  return {
    detach(detachOptions: DetachOptions = {}): void {
      if (detached) {
        return;
      }
      const { flush: shouldFlush = true } = detachOptions;
      if (shouldFlush) {
        flush();
      }
      detached = true;
      unsubscribe();
    },
  };
}

function isMissingPassphraseError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /networkPassphrase/i.test(error.message);
}
