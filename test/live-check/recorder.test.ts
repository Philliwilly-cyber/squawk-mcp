import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Recording, recordingFetch } from "../../src/live-check/recorder.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "squawk-rec-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("recordingFetch", () => {
  it("saves API responses with the rate-limit headers", async () => {
    const inner = vi.fn(() =>
      Promise.resolve(
        new Response('{"time":1,"states":[]}', { headers: { "X-Rate-Limit-Remaining": "3999", "Set-Cookie": "x=y" } }),
      ),
    );
    const recordings: Recording[] = [];
    const fetchFn = recordingFetch(inner, dir, recordings);
    const response = await fetchFn("https://opensky-network.org/api/states/all?lamin=1", {
      headers: { Authorization: "Bearer secret-token" },
    });
    // The caller still gets a readable body.
    expect(await response.json()).toEqual({ time: 1, states: [] });

    const saved = await readFile(recordings[0]?.file ?? "", "utf8");
    expect(JSON.parse(saved)).toEqual({
      url: "https://opensky-network.org/api/states/all?lamin=1",
      status: 200,
      headers: { "content-type": "text/plain;charset=UTF-8", "x-rate-limit-remaining": "3999" },
      body: { time: 1, states: [] },
    });
    expect(saved).not.toContain("secret-token");
    expect(saved).not.toContain("Set-Cookie");
  });

  it("never records the token endpoint or other hosts", async () => {
    const inner = vi.fn(() => Promise.resolve(new Response('{"access_token":"secret"}')));
    const fetchFn = recordingFetch(inner, dir);
    await fetchFn("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token", {
      method: "POST",
    });
    await fetchFn("https://opensky-network.org/api/states/all", { method: "POST" });
    await fetchFn("https://davidmegginson.github.io/ourairports-data/airports.csv");
    expect(await readdir(dir)).toEqual([]);
  });
});
