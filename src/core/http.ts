export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** An HTTP response with a non-success status, or a request that failed before a response arrived. */
export class HttpError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 for network errors and timeouts. */
    readonly status: number,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "HttpError";
  }

  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/** Wraps fetch with a timeout and turns network failures into HttpError(status 0). */
export async function fetchWithTimeout(
  fetchFn: FetchLike,
  url: string | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new HttpError(`Request to ${new URL(url).host} failed: ${reason}`, 0);
  }
}
