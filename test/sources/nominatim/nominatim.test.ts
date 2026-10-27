import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Throttle } from "../../../src/core/throttle.js";
import { Nominatim } from "../../../src/sources/nominatim/nominatim.js";
import { jsonResponse, routeFetch } from "../../helpers.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "squawk-nominatim-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const hamburg = {
  lat: "53.5503",
  lon: "10.0007",
  display_name: "Hamburg, Deutschland",
  category: "boundary",
  type: "administrative",
  boundingbox: ["53.3951", "53.9644", "8.4213", "10.3252"],
};

describe("Nominatim", () => {
  it("geocodes with an identifying User-Agent and caches on disk", async () => {
    const fetchFn = routeFetch({
      "/search": (url, init) => {
        expect(url.searchParams.get("q")).toBe("Hamburg");
        expect((init?.headers as Record<string, string>)["User-Agent"]).toBe("squawk-mcp/test");
        return jsonResponse([hamburg]);
      },
    });
    const options = { baseUrl: "https://nominatim.example", userAgent: "squawk-mcp/test", cacheDir: dir, fetchFn, throttle: new Throttle(0) };

    const first = await new Nominatim(options).geocode("Hamburg");
    expect(first.place).toMatchObject({ lat: 53.5503, lon: 10.0007, boundingBox: { lamin: 53.3951, lomax: 10.3252 } });
    expect(first.cached).toBe(false);

    // A new instance reads the persisted cache: no second request.
    const second = await new Nominatim(options).geocode("  hamburg ");
    expect(second.cached).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("caches 'not found' too", async () => {
    const fetchFn = routeFetch({ "/search": () => jsonResponse([]) });
    const nominatim = new Nominatim({ baseUrl: "https://nominatim.example", userAgent: "t", cacheDir: dir, fetchFn, throttle: new Throttle(0) });
    expect((await nominatim.geocode("Atlantis")).place).toBeNull();
    expect((await nominatim.geocode("Atlantis")).cached).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("keeps a path prefix of a self-hosted instance", async () => {
    const fetchFn = routeFetch({ "/nominatim/search": () => jsonResponse([hamburg]) });
    const nominatim = new Nominatim({ baseUrl: "https://geo.example/nominatim", userAgent: "t", cacheDir: dir, fetchFn, throttle: new Throttle(0) });
    expect((await nominatim.geocode("Hamburg")).place?.lat).toBe(53.5503);
  });

  it("keeps all entries when the first lookups run concurrently", async () => {
    const fetchFn = routeFetch({ "/search": () => jsonResponse([hamburg]) });
    const options = { baseUrl: "https://nominatim.example", userAgent: "t", cacheDir: dir, fetchFn, throttle: new Throttle(0) };
    const nominatim = new Nominatim(options);
    await Promise.all([nominatim.geocode("Hamburg"), nominatim.geocode("Berlin")]);
    const fresh = new Nominatim(options);
    expect((await fresh.geocode("Hamburg")).cached).toBe(true);
    expect((await fresh.geocode("Berlin")).cached).toBe(true);
  });

  it("retries a 429 a few times, slowly", async () => {
    let calls = 0;
    const fetchFn = routeFetch({
      "/search": () => (++calls < 3 ? new Response("", { status: 429 }) : jsonResponse([hamburg])),
    });
    const sleeps: number[] = [];
    const nominatim = new Nominatim({
      baseUrl: "https://nominatim.example",
      userAgent: "t",
      cacheDir: dir,
      fetchFn,
      throttle: new Throttle(0),
      retry: {
        retries: 2,
        baseDelayMs: 2_000,
        maxDelayMs: 5_000,
        maxTotalWaitMs: 10_000,
        random: () => 1,
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      },
    });
    expect((await nominatim.geocode("Hamburg")).place?.lat).toBe(53.5503);
    expect(sleeps).toEqual([2_000, 4_000]);
  });
});
