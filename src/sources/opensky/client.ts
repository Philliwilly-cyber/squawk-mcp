import { type FetchLike, HttpError, fetchWithTimeout, parseRetryAfter } from "../../core/http.js";
import { logWarn } from "../../core/log.js";
import { DEFAULT_RETRY, type RetryOptions, withRetry } from "../../core/retry.js";
import { toBerlinIso } from "../../core/time.js";
import { CreditTracker, bucketForPath } from "./credits.js";
import { AuthError, type TokenManager } from "./token.js";

export type OpenSkyAuthMode = "oauth2" | "anonymous";

export type QueryValue = string | number | readonly (string | number)[] | undefined;

export interface OpenSkyResponse {
  /** Parsed JSON body, or null when the endpoint answered 404 ("nothing found"). */
  body: unknown;
  authMode: OpenSkyAuthMode;
  warnings: string[];
}

export interface OpenSkyClientOptions {
  baseUrl: string;
  userAgent: string;
  fetchFn: FetchLike;
  tokens: TokenManager | null;
  credits?: CreditTracker;
  retry?: RetryOptions;
  timeoutMs?: number;
  now?: () => number;
}

const ANONYMOUS_WARNING =
  "Anonymous mode: no OpenSky credentials configured (OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET). " +
  "Only the latest data, 10 s resolution and 400 credits per day shared by your IP.";

/** Low-level OpenSky REST client: auth, credit tracking, retries. No caching. */
export class OpenSkyClient {
  readonly credits: CreditTracker;
  private readonly timeoutMs: number;
  private readonly retry: RetryOptions;
  private readonly now: () => number;
  /** Set once the token endpoint has rejected our credentials, to stop retrying it on every call. */
  private authFailure: string | null = null;

  constructor(private readonly options: OpenSkyClientOptions) {
    this.credits = options.credits ?? new CreditTracker();
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.retry = options.retry ?? DEFAULT_RETRY;
    this.now = options.now ?? Date.now;
  }

  get configuredAuthMode(): OpenSkyAuthMode {
    return this.options.tokens && this.authFailure === null ? "oauth2" : "anonymous";
  }

  async get(path: string, query: Record<string, QueryValue>, notFoundIsEmpty: boolean): Promise<OpenSkyResponse> {
    const url = this.buildUrl(path, query);
    const warnings: string[] = [];
    const token = await this.token(warnings);

    let response = await withRetry(() => this.send(url, token), this.retry);
    let authMode: OpenSkyAuthMode = token === null ? "anonymous" : "oauth2";

    if (response.status === 401 && token !== null && this.options.tokens) {
      // Token expired early or was revoked: fetch a new one and try exactly once more.
      this.options.tokens.invalidate();
      const fresh = await this.token(warnings);
      authMode = fresh === null ? "anonymous" : "oauth2";
      response = await withRetry(() => this.send(url, fresh), this.retry);
    }

    this.recordCredits(path, response);

    if (response.status === 404 && notFoundIsEmpty) {
      return { body: null, authMode, warnings };
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300).trim();
      throw new HttpError(
        `OpenSky ${path} answered ${response.status}${detail ? `: ${detail}` : ""}`,
        response.status,
      );
    }
    return { body: await response.json(), authMode, warnings };
  }

  private async token(warnings: string[]): Promise<string | null> {
    const tokens = this.options.tokens;
    if (!tokens) {
      warnings.push(ANONYMOUS_WARNING);
      return null;
    }
    if (this.authFailure !== null) {
      warnings.push(`${this.authFailure} Falling back to anonymous mode.`);
      return null;
    }
    try {
      return await tokens.getToken();
    } catch (error) {
      if (error instanceof AuthError) {
        this.authFailure = error.message;
        logWarn(error.message);
        warnings.push(`${error.message} Falling back to anonymous mode.`);
        return null;
      }
      // Token endpoint temporarily unreachable: answer anonymously this time, try again next call.
      const reason = error instanceof Error ? error.message : String(error);
      warnings.push(`Could not obtain an OpenSky token (${reason}); this request was made anonymously.`);
      return null;
    }
  }

  private async send(url: URL, token: string | null): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": this.options.userAgent };
    if (token !== null) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetchWithTimeout(this.options.fetchFn, url, { headers }, this.timeoutMs);
    if (response.status === 429) {
      const retryAfter = parseRetryAfter(response.headers.get("X-Rate-Limit-Retry-After-Seconds"));
      const bucket = bucketForPath(url.pathname.replace(/^\/api/, ""));
      // The bucket is empty; record that, so later cached answers do not report an old balance.
      this.credits.record(bucket, 0, this.now());
      const until =
        retryAfter === null ? "" : ` Credits refill in about ${Math.ceil(retryAfter / 60)} min (${toBerlinIso(new Date(this.now() + retryAfter * 1000))}).`;
      throw new HttpError(`OpenSky credit quota for /${bucket} is exhausted (429).${until}`, 429, retryAfter);
    }
    if (response.status >= 500) {
      throw new HttpError(`OpenSky answered ${response.status}`, response.status);
    }
    return response;
  }

  private recordCredits(path: string, response: Response): void {
    const remaining = Number(response.headers.get("X-Rate-Limit-Remaining") ?? Number.NaN);
    if (Number.isFinite(remaining)) this.credits.record(bucketForPath(path), remaining, this.now());
  }

  private buildUrl(path: string, query: Record<string, QueryValue>): URL {
    const url = new URL(`${this.options.baseUrl.replace(/\/$/, "")}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      const values: readonly (string | number)[] = Array.isArray(value) ? value : [value as string | number];
      for (const v of values) url.searchParams.append(key, String(v));
    }
    return url;
  }
}
