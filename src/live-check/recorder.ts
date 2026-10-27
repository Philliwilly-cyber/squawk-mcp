import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FetchLike } from "../core/http.js";

/** Hosts whose responses are worth keeping as test fixtures. */
const RECORDED_HOSTS = new Set(["opensky-network.org", "nominatim.openstreetmap.org"]);
const KEPT_HEADERS = ["content-type", "x-rate-limit-remaining", "x-rate-limit-retry-after-seconds"];

export interface Recording {
  file: string;
  url: string;
  status: number;
}

/**
 * Wraps fetch and saves API responses as JSON fixtures. Only GET requests to the
 * recorded hosts are saved: never the OAuth token endpoint (a different host, and a
 * POST), never request headers, so no credentials can end up in a fixture.
 */
export function recordingFetch(inner: FetchLike, dir: string, recordings: Recording[] = []): FetchLike {
  let counter = 0;
  return async (input, init) => {
    const response = await inner(input, init);
    const url = new URL(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET" || !RECORDED_HOSTS.has(url.hostname)) return response;

    const text = await response.clone().text();
    let body: unknown = text;
    try {
      body = text === "" ? null : (JSON.parse(text) as unknown);
    } catch {
      // keep the raw text
    }
    const headers: Record<string, string> = {};
    for (const name of KEPT_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    counter++;
    const slug = `${url.hostname}${url.pathname}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    const file = join(dir, `${String(counter).padStart(2, "0")}-${slug}.json`);
    await mkdir(dir, { recursive: true });
    await writeFile(file, `${JSON.stringify({ url: url.href, status: response.status, headers, body }, null, 2)}\n`);
    recordings.push({ file, url: url.href, status: response.status });
    return response;
  };
}
