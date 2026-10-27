import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../../../src/core/http.js";
import { OpenSkyClient } from "../../../src/sources/opensky/client.js";
import { TokenManager } from "../../../src/sources/opensky/token.js";
import { jsonResponse, noRetry, routeFetch } from "../../helpers.js";

const base = { baseUrl: "https://opensky.example/api", userAgent: "test", retry: noRetry };

describe("OpenSkyClient", () => {
  it("works anonymously and says so", async () => {
    const fetchFn = routeFetch({ "/api/states/all": () => jsonResponse({ time: 1, states: [] }) });
    const client = new OpenSkyClient({ ...base, fetchFn, tokens: null });
    const result = await client.get("/states/all", { lamin: 1, icao24: ["a", "b"] }, false);
    expect(result.authMode).toBe("anonymous");
    expect(result.warnings[0]).toMatch(/Anonymous mode/);
    const url = new URL(fetchFn.mock.calls[0]?.[0] ?? "");
    expect(url.searchParams.getAll("icao24")).toEqual(["a", "b"]);
  });

  it("sends a bearer token and records credits", async () => {
    const fetchFn = routeFetch({
      "/token": () => jsonResponse({ access_token: "tok", expires_in: 1800 }),
      "/api/states/all": (_url, init) => {
        expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
        return jsonResponse({ time: 1, states: [] }, 200, { "X-Rate-Limit-Remaining": "3999" });
      },
    });
    const tokens = new TokenManager({ clientId: "a", clientSecret: "b" }, "https://auth.example/token", fetchFn);
    const client = new OpenSkyClient({ ...base, fetchFn, tokens });
    const result = await client.get("/states/all", {}, false);
    expect(result.authMode).toBe("oauth2");
    expect(client.credits.get("states")?.remaining).toBe(3999);
  });

  it("refreshes the token once on 401", async () => {
    let tokenCalls = 0;
    let apiCalls = 0;
    const fetchFn = routeFetch({
      "/token": () => jsonResponse({ access_token: `tok${++tokenCalls}` }),
      "/api/flights/all": () => (++apiCalls === 1 ? new Response("", { status: 401 }) : jsonResponse([])),
    });
    const tokens = new TokenManager({ clientId: "a", clientSecret: "b" }, "https://auth.example/token", fetchFn);
    const client = new OpenSkyClient({ ...base, fetchFn, tokens });
    await client.get("/flights/all", {}, true);
    expect(tokenCalls).toBe(2);
    expect(apiCalls).toBe(2);
  });

  it("falls back to anonymous mode when credentials are rejected", async () => {
    const fetchFn = routeFetch({
      "/token": () => new Response("", { status: 401 }),
      "/api/states/all": () => jsonResponse({ time: 1, states: [] }),
    });
    const tokens = new TokenManager({ clientId: "a", clientSecret: "b" }, "https://auth.example/token", fetchFn);
    const client = new OpenSkyClient({ ...base, fetchFn, tokens });
    const result = await client.get("/states/all", {}, false);
    expect(result.authMode).toBe("anonymous");
    expect(result.warnings[0]).toMatch(/rejected the client credentials/);
    expect(client.configuredAuthMode).toBe("anonymous");
  });

  it("treats 404 as empty when asked to", async () => {
    const fetchFn = routeFetch({ "/api/flights/arrival": () => new Response("", { status: 404 }) });
    const client = new OpenSkyClient({ ...base, fetchFn, tokens: null });
    expect((await client.get("/flights/arrival", {}, true)).body).toBeNull();
  });

  it("explains an exhausted quota", async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response("", { status: 429, headers: { "X-Rate-Limit-Retry-After-Seconds": "600" } })),
    );
    const client = new OpenSkyClient({ ...base, fetchFn, tokens: null });
    const error = await client.get("/flights/all", {}, true).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).message).toMatch(/quota for \/flights is exhausted.*10 min/);
  });
});
