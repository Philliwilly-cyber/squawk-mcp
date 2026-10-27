import { HttpError } from "./http.js";

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Give up instead of waiting longer than this in total (e.g. an exhausted daily quota). */
  maxTotalWaitMs: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export const DEFAULT_RETRY: RetryOptions = {
  retries: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  maxTotalWaitMs: 20_000,
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Retries 429, 5xx and network errors with exponential backoff and full jitter. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = DEFAULT_RETRY): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  let waited = 0;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof HttpError) || !error.retryable || attempt >= options.retries) throw error;

      const backoff = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt) * random();
      const delay = error.retryAfterSeconds === null ? backoff : error.retryAfterSeconds * 1000;
      if (waited + delay > options.maxTotalWaitMs) throw error;

      waited += delay;
      await sleep(delay);
    }
  }
}
