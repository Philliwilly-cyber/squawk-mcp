import type { OpenSkyCredentials } from "../../config.js";
import { type FetchLike, HttpError, fetchWithTimeout } from "../../core/http.js";

/** Refresh this long before the token actually expires. */
const REFRESH_MARGIN_MS = 60_000;
const DEFAULT_LIFETIME_S = 1_800;

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** OAuth2 client-credentials token, cached and refreshed before it expires. */
export class TokenManager {
  private token: string | null = null;
  private expiresAt = 0;
  private refreshing: Promise<string> | null = null;

  constructor(
    private readonly credentials: OpenSkyCredentials,
    private readonly tokenUrl: string,
    private readonly fetchFn: FetchLike,
    private readonly now: () => number = Date.now,
  ) {}

  async getToken(): Promise<string> {
    if (this.token !== null && this.now() < this.expiresAt) return this.token;
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** Forget the token, e.g. after the API answered 401. */
  invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
  }

  private async refresh(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
    });
    const response = await fetchWithTimeout(
      this.fetchFn,
      this.tokenUrl,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
      15_000,
    );

    if (response.status === 400 || response.status === 401) {
      throw new AuthError(
        "OpenSky rejected the client credentials (OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET). " +
          "Check them on https://opensky-network.org/my-opensky/account.",
      );
    }
    if (!response.ok) {
      throw new HttpError(`OpenSky token endpoint answered ${response.status}`, response.status);
    }

    const data = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof data.access_token !== "string") throw new AuthError("OpenSky token response had no access_token");
    const lifetimeS = typeof data.expires_in === "number" ? data.expires_in : DEFAULT_LIFETIME_S;

    this.token = data.access_token;
    // Short-lived tokens would otherwise never be reused; refresh those at half their lifetime.
    const marginMs = Math.min(REFRESH_MARGIN_MS, (lifetimeS * 1000) / 2);
    this.expiresAt = this.now() + lifetimeS * 1000 - marginMs;
    return this.token;
  }
}
