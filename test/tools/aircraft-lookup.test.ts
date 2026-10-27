import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, resultJson, startServer } from "../harness.js";
import { fixture, jsonResponse } from "../helpers.js";

let harness: Harness;

beforeAll(async () => {
  harness = await startServer(
    {
      "/api/states/all": () => jsonResponse(fixture("states-all.json")),
      "/aircraft.csv": () => new Response("", { status: 503 }),
    },
    new Date(1_507_203_252_000),
  );
});

afterAll(async () => {
  await harness.close();
});

describe("aircraft_lookup without the aircraft database", () => {
  it("treats a hyphenated query as a registration and explains the missing database", async () => {
    const result = await harness.client.callTool({ name: "aircraft_lookup", arguments: { query: "D-AIZZ" } });
    expect(result.isError).toBe(true);
    expect(resultJson(result)["error"]).toMatch(/registrations cannot be resolved while the aircraft database is unavailable/);
    // No credits are spent on a callsign search that could never match.
    expect(harness.fetchFn.mock.calls.some(([url]) => String(url).includes("/states/all"))).toBe(false);
  });

  it("honours an explicit icao24 kind", async () => {
    const result = await harness.client.callTool({
      name: "aircraft_lookup",
      arguments: { query: "aa8c39", kind: "icao24" },
    });
    const data = resultJson(result)["data"] as Record<string, unknown>;
    expect(data).toMatchObject({ matched_by: "icao24", icao24: "aa8c39" });
  });

  it("rejects a non-hex query with kind icao24", async () => {
    const result = await harness.client.callTool({ name: "aircraft_lookup", arguments: { query: "D-AIZZ", kind: "icao24" } });
    expect(result.isError).toBe(true);
  });
});
