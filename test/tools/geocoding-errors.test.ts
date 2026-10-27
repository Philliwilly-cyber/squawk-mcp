import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, resultJson, startServer } from "../harness.js";

let harness: Harness;

beforeAll(async () => {
  harness = await startServer({ "/search": () => new Response("", { status: 429 }) }, new Date("2026-10-27T10:00:00Z"));
});

afterAll(async () => {
  await harness.close();
});

describe("geocoding errors", () => {
  it("blame Nominatim, not the OpenSky quota, and suggest coordinates", async () => {
    const result = await harness.client.callTool({ name: "flights_in_area", arguments: { place: "Bayern" } });
    expect(result.isError).toBe(true);
    const json = resultJson(result);
    expect(json["error"]).toMatch(/Nominatim .* rate-limiting/);
    expect(json["hint"]).toMatch(/coordinates/);
    expect(JSON.stringify(json)).not.toMatch(/OpenSky credits/);
  });
});
