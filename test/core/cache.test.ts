import { describe, expect, it, vi } from "vitest";
import { TtlCache } from "../../src/core/cache.js";

function makeCache(): { cache: TtlCache<string>; advance: (ms: number) => void } {
  let now = 1_000_000;
  const cache = new TtlCache<string>({ ttlMs: 10_000, maxStaleMs: 60_000, now: () => now });
  return { cache, advance: (ms) => (now += ms) };
}

describe("TtlCache", () => {
  it("serves cached values within the TTL", async () => {
    const { cache, advance } = makeCache();
    const load = vi.fn().mockResolvedValue("a");
    expect((await cache.get("k", load)).status).toBe("fresh");
    advance(5_000);
    expect((await cache.get("k", load)).status).toBe("cached");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent loads", async () => {
    const { cache } = makeCache();
    const load = vi.fn(() => new Promise<string>((resolve) => setTimeout(() => { resolve("a"); }, 10)));
    const [a, b] = await Promise.all([cache.get("k", load), cache.get("k", load)]);
    expect(a.value).toBe("a");
    expect(b.value).toBe("a");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("falls back to stale data when the upstream fails", async () => {
    const { cache, advance } = makeCache();
    await cache.get("k", () => Promise.resolve("old"));
    advance(30_000);
    const result = await cache.get("k", () => Promise.reject(new Error("down")));
    expect(result).toMatchObject({ value: "old", status: "stale" });
  });

  it("rethrows when stale data is too old", async () => {
    const { cache, advance } = makeCache();
    await cache.get("k", () => Promise.resolve("old"));
    advance(100_000);
    await expect(cache.get("k", () => Promise.reject(new Error("down")))).rejects.toThrow("down");
  });
});
