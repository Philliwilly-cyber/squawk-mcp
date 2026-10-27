export type DatasetState<T> =
  | { status: "ready"; data: T; updatedAt: number; refreshError?: string }
  | { status: "loading" }
  | { status: "failed"; error: string };

export interface Loaded<T> {
  data: T;
  updatedAt: number;
  refreshError?: string;
}

/**
 * A dataset that loads in the background (download + parse), so the server starts
 * immediately. Callers wait a bounded time and otherwise get "loading".
 */
export class LazyDataset<T> {
  private promise: Promise<Loaded<T>> | null = null;
  private state: DatasetState<T> = { status: "loading" };
  private failedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly loader: () => Promise<Loaded<T>>,
    /** After a failed load, wait this long before trying again (a dataset can be a large download). */
    private readonly retryAfterMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** The current state, without starting or waiting for a load. */
  peek(): DatasetState<T> {
    return this.state;
  }

  start(): void {
    if (this.promise) return;
    if (this.state.status === "failed" && this.now() - this.failedAt < this.retryAfterMs) return;
    this.promise = this.loader().then(
      (loaded) => {
        this.state = { status: "ready", ...loaded };
        return loaded;
      },
      (error: unknown) => {
        this.state = { status: "failed", error: error instanceof Error ? error.message : String(error) };
        this.failedAt = this.now();
        // Allow a later call to try again once the cool-down has passed.
        this.promise = null;
        throw error;
      },
    );
    // Errors are reported through the state; do not crash on unhandled rejections.
    this.promise.catch(() => undefined);
  }

  async get(waitMs: number): Promise<DatasetState<T>> {
    if (this.state.status === "ready") return this.state;
    this.start();
    const pending = this.promise;
    if (pending) {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, waitMs);
      });
      await Promise.race([pending.catch(() => undefined), timeout]);
      clearTimeout(timer);
    }
    return this.state;
  }
}
