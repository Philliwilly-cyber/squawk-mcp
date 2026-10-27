import { readFileSync } from "node:fs";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, resultJson as text, startServer } from "./harness.js";
import { fixture, jsonResponse } from "./helpers.js";

// 2017-10-05 11:34:12 UTC, a few seconds after the fixture's state vectors.
const NOW = new Date(1_507_203_252_000);

const aircraftCsv = `icao24,registration,manufacturername,model,typecode,operator,operatoricao,owner,built
aa8c39,N12345,Boeing,737-924,B739,United Airlines,UAL,Someone,2001-01-01
`;

let harness: Harness;
let client: Client;

beforeAll(async () => {
  harness = await startServer(
    {
      "/api/states/all": () => jsonResponse(fixture("states-all.json"), 200, { "X-Rate-Limit-Remaining": "399" }),
      "/search": () =>
        jsonResponse([
          { lat: "33.9", lon: "-118.1", display_name: "Downey, California", boundingbox: ["33.8", "34.0", "-118.2", "-118.0"] },
        ]),
      "/airports.csv": () => new Response(readFileSync(new URL("./fixtures/airports.csv", import.meta.url), "utf8")),
      "/aircraft.csv": () => new Response(aircraftCsv),
    },
    NOW,
  );
  client = harness.client;
});

afterAll(async () => {
  await harness.close();
});

describe("squawk-mcp server", () => {
  it("lists only read-only tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "aircraft_flight_history",
      "aircraft_lookup",
      "aircraft_track",
      "airport_info",
      "airport_traffic",
      "emergency_squawks",
      "explain_squawk",
      "flights_in_area",
      "flights_overhead",
      "service_status",
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("answers flights_overhead with the full envelope", async () => {
    const result = text(await client.callTool({ name: "flights_overhead", arguments: { place: "Downey", radius_km: 20 } }));
    expect(result).toMatchObject({
      server_time: "2017-10-05T13:34:12+02:00",
      data_age_seconds: 2,
      auth_mode: "anonymous",
      cache: "fresh",
    });
    expect(result["source"]).toEqual(expect.arrayContaining(["OpenSky Network REST /states/all", "Nominatim (OpenStreetMap)"]));
    expect((result["coverage_notes"] as string[]).length).toBeGreaterThan(0);
    const warnings = result["warnings"] as string[];
    expect(warnings.some((w) => w.includes("Anonymous mode"))).toBe(true);
    expect(warnings.some((w) => w.includes("UAL534 is squawking 7700"))).toBe(true);

    const data = result["data"] as { aircraft: Record<string, unknown>[]; quota: unknown };
    expect(data.aircraft).toHaveLength(1);
    expect(data.aircraft[0]).toMatchObject({
      callsign: "UAL534",
      altitude_barometric: { m: 1760, ft: 5775 },
      ground_speed: { kmh: 401, kn: 216 },
      squawk: { code: "7700", category: "emergency" },
    });
    expect(data.quota).toEqual({ estimated_cost: 1, remaining_today: 399 });
  });

  it("refuses large areas unless allowed", async () => {
    const result = await client.callTool({
      name: "flights_in_area",
      arguments: { lamin: 40, lomin: 0, lamax: 60, lomax: 20 },
    });
    expect(result.isError).toBe(true);
    expect(text(result)["error"]).toMatch(/would cost 3 OpenSky credits/);
  });

  it("explains a squawk offline", async () => {
    const result = text(await client.callTool({ name: "explain_squawk", arguments: { code: "7600" } }));
    expect(result["data"]).toMatchObject({ code: "7600", category: "emergency", label: "Radio communication failure" });
    expect((result["warnings"] as string[])[0]).toMatch(/7600 is an emergency code/);
  });

  it("refuses today's airport history with a hint to the live mode", async () => {
    const result = await client.callTool({
      name: "airport_traffic",
      arguments: { airport: "EDDF", date: "2017-10-05" },
    });
    expect(result.isError).toBe(true);
    expect(text(result)["hint"]).toMatch(/live_nearby/);
  });

  it("asks for an area before searching a callsign", async () => {
    const result = await client.callTool({ name: "aircraft_lookup", arguments: { query: "DLH4AB", kind: "callsign" } });
    expect(result.isError).toBe(true);
    expect(text(result)["hint"]).toMatch(/search_worldwide/);
  });

  it("looks up a registration in the aircraft database without leaking the owner", async () => {
    const result = await client.callTool({ name: "aircraft_lookup", arguments: { query: "N12345", live: false } });
    const data = text(result)["data"] as Record<string, unknown>;
    expect(data).toMatchObject({ matched_by: "registration", icao24: "aa8c39", aircraft: { typecode: "B739" } });
    expect(JSON.stringify(result)).not.toContain("Someone");
  });

  it("finds airports by city", async () => {
    const result = text(await client.callTool({ name: "airport_info", arguments: { query: "Hamburg", limit: 1 } }));
    const data = result["data"] as { airports: Record<string, unknown>[] };
    expect(data.airports[0]).toMatchObject({ icao: "EDDH", iata: "HAM", elevation: { m: 16, ft: 53 } });
  });

  it("serves the squawk reference resource", async () => {
    const resource = await client.readResource({ uri: "squawk://reference/codes" });
    const first = resource.contents[0];
    expect(first && "text" in first ? first.text : "").toContain("7700");
  });
});
