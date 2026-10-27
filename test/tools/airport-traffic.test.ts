import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, resultJson, startServer } from "../harness.js";
import { fixture, jsonResponse } from "../helpers.js";

const NOW = new Date("2026-10-23T08:00:00Z");
const nowS = NOW.getTime() / 1000;

// Around Frankfurt (EDDF, elevation 364 ft): one on the ground, one on final approach, one overflying.
const statesNearFrankfurt = {
  time: nowS,
  states: [
    ["3c6444", "DLH9AB  ", "Germany", nowS, nowS, 8.56, 50.04, null, true, 5, 70, null, null, null, "1000", false, 0, 4],
    ["3c6555", "DLH1CD  ", "Germany", nowS, nowS, 8.4, 50.07, 700, false, 75, 70, -4, null, 720, "1000", false, 0, 4],
    ["4ca123", "RYR1EF  ", "Ireland", nowS, nowS, 8.6, 50.1, 11_000, false, 230, 300, 0, null, 11_050, "7700", false, 0, 4],
  ],
};

let harness: Harness;

beforeAll(async () => {
  harness = await startServer(
    {
      "/api/states/all": () => jsonResponse(statesNearFrankfurt),
      "/api/flights/arrival": () => jsonResponse(fixture("flights-arrival.json"), 200, { "X-Rate-Limit-Remaining": "3970" }),
      "/api/flights/departure": () => new Response("", { status: 503 }),
      "/airports.csv": () => new Response(readFileSync(new URL("../fixtures/airports.csv", import.meta.url), "utf8")),
      "/aircraft.csv": () => new Response("icao24,registration\n"),
    },
    NOW,
  );
});

afterAll(async () => {
  await harness.close();
});

describe("airport_traffic", () => {
  it("keeps the arrivals when the departures fail", async () => {
    const result = await harness.client.callTool({
      name: "airport_traffic",
      arguments: { airport: "FRA", direction: "both", date: "2026-10-22" },
    });
    expect(result.isError).toBeFalsy();
    const json = resultJson(result);
    const data = json["data"] as Record<string, unknown>;
    expect(data["arrivals"]).toMatchObject({ count: 1, flights: [{ callsign: "DLH1AB", from: "Berlin-Tegel Airport (closed)" }] });
    expect(data["departures"]).toBeNull();
    expect((json["warnings"] as string[]).some((w) => w.startsWith("The departures could not be loaded"))).toBe(true);
  });

  it("estimates the phase of aircraft around the airport", async () => {
    const result = await harness.client.callTool({
      name: "airport_traffic",
      arguments: { airport: "EDDF", mode: "live_nearby", radius_km: 20 },
    });
    const json = resultJson(result);
    const aircraft = (json["data"] as { aircraft: { callsign: string; phase: string }[] }).aircraft;
    expect(Object.fromEntries(aircraft.map((a) => [a.callsign, a.phase]))).toEqual({
      DLH9AB: "on ground",
      DLH1CD: "likely approaching / landing",
      RYR1EF: "in the vicinity / overflying",
    });
    expect((json["warnings"] as string[]).some((w) => w.includes("RYR1EF is squawking 7700"))).toBe(true);
  });
});
