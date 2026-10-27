export type CacheStatus = "fresh" | "cached" | "stale";

export interface CacheResult<V> {
  value: V;
  status: CacheStatus;
  /** When the value was fetched from upstream (ms since epoch). */
  storedAt: number;
  /** The upstream error that forced a stale answer. */
  error?: unknown;
}

interface Entry<V> {
  value: V;
  storedAt: number;
}

export interface CacheOptions {
  /** How long a value counts as current. */
  ttlMs: number;
  /** How long an expired value may still be served when upstream fails. */
  maxStaleMs: number;
  maxEntries?: number;
  now?: () => number;
}

/**
 * TTL cache with stale-on-error fallback and in-flight request coalescing:
 * concurrent loads for the same key share one upstream request.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly inFlight = new Map<string, Promise<CacheResult<V>>>();
  private readonly ttlMs: number;
  private readonly maxStaleMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: CacheOptions) {
    this.ttlMs = options.ttlMs;
    this.maxStaleMs = options.maxStaleMs;
    this.maxEntries = options.maxEntries ?? 500;
    this.now = options.now ?? Date.now;
  }

  peek(key: string): Entry<V> | undefined {
    const entry = this.entries.get(key);
    if (entry && this.now() - entry.storedAt <= this.ttlMs) return entry;
    return undefined;
  }

  /** All entries that are still within their TTL. */
  *freshEntries(): Generator<[string, Entry<V>]> {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.storedAt <= this.ttlMs) yield [key, entry];
    }
  }

  async get(key: string, load: () => Promise<V>): Promise<CacheResult<V>> {
    const current = this.peek(key);
    if (current) return { value: current.value, status: "cached", storedAt: current.storedAt };

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = this.load(key, load).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  private async load(key: string, load: () => Promise<V>): Promise<CacheResult<V>> {
    try {
      const value = await load();
      const storedAt = this.now();
      this.set(key, value, storedAt);
      return { value, status: "fresh", storedAt };
    } catch (error) {
      const old = this.entries.get(key);
      if (old && this.now() - old.storedAt <= this.ttlMs + this.maxStaleMs) {
        return { value: old.value, status: "stale", storedAt: old.storedAt, error };
      }
      throw error;
    }
  }

  private set(key: string, value: V, storedAt: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, storedAt });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
