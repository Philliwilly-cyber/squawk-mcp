import { readFileSync } from "node:fs";
import { vi } from "vitest";

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

/** A fetch mock that answers by URL pathname. */
export function routeFetch(routes: Record<string, (url: URL, init?: RequestInit) => Response>) {
  return vi.fn((input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    const handler = routes[url.pathname];
    if (!handler) return Promise.resolve(new Response("not mocked", { status: 599 }));
    return Promise.resolve(handler(url, init));
  });
}

export const noRetry = { retries: 0, baseDelayMs: 0, maxDelayMs: 0, maxTotalWaitMs: 0 };
