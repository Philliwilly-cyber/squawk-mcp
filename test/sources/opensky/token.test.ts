import { describe, expect, it, vi } from "vitest";
import { AuthError, TokenManager } from "../../../src/sources/opensky/token.js";

const credentials = { clientId: "id", clientSecret: "secret" };

function tokenResponse(token: string, expiresIn = 1800): Response {
  return new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), { status: 200 });
}

describe("TokenManager", () => {
  it("caches the token until shortly before expiry", async () => {
    let now = 0;
    const fetchFn = vi.fn().mockResolvedValueOnce(tokenResponse("a")).mockResolvedValueOnce(tokenResponse("b"));
    const manager = new TokenManager(credentials, "https://auth.example/token", fetchFn, () => now);

    expect(await manager.getToken()).toBe("a");
    now = 1_000_000; // 16.6 min
    expect(await manager.getToken()).toBe("a");
    now = 1_750_000; // within the refresh margin
    expect(await manager.getToken()).toBe("b");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("sends client credentials as a form", async () => {
    const fetchFn = vi.fn().mockResolvedValue(tokenResponse("a"));
    await new TokenManager(credentials, "https://auth.example/token", fetchFn).getToken();
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.body as URLSearchParams).toString()).toBe("grant_type=client_credentials&client_id=id&client_secret=secret");
  });

  it("refreshes only once for concurrent callers", async () => {
    const fetchFn = vi.fn().mockResolvedValue(tokenResponse("a"));
    const manager = new TokenManager(credentials, "https://auth.example/token", fetchFn);
    await Promise.all([manager.getToken(), manager.getToken(), manager.getToken()]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refetches after invalidate", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(tokenResponse("a")).mockResolvedValueOnce(tokenResponse("b"));
    const manager = new TokenManager(credentials, "https://auth.example/token", fetchFn);
    await manager.getToken();
    manager.invalidate();
    expect(await manager.getToken()).toBe("b");
  });

  it("reports rejected credentials clearly", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    const manager = new TokenManager(credentials, "https://auth.example/token", fetchFn);
    await expect(manager.getToken()).rejects.toBeInstanceOf(AuthError);
  });
});

describe("TokenManager with short-lived tokens", () => {
  it("reuses a token shorter-lived than the refresh margin", async () => {
    let now = 0;
    const fetchFn = vi.fn().mockResolvedValue(tokenResponse("a", 30));
    const manager = new TokenManager(credentials, "https://auth.example/token", fetchFn, () => now);
    await manager.getToken();
    now = 10_000;
    await manager.getToken();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
