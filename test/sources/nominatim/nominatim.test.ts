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
});
