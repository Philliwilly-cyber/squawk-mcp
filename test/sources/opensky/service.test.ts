import { describe, expect, it } from "vitest";
import { OpenSkyClient } from "../../../src/sources/opensky/client.js";
import { InvalidRequestError, OpenSkyService } from "../../../src/sources/opensky/service.js";
import { fixture, jsonResponse, noRetry, routeFetch } from "../../helpers.js";

function makeService(routes: Parameters<typeof routeFetch>[0]) {
  let now = Date.parse("2026-10-23T08:00:00Z");
  const fetchFn = routeFetch(routes);
  const client = new OpenSkyClient({
    baseUrl: "https://opensky.example/api",
    userAgent: "test",
    fetchFn,
    tokens: null,
    retry: noRetry,
    now: () => now,
  });
  const service = new OpenSkyService(client, () => now);
  return { service, fetchFn, advance: (ms: number) => (now += ms) };
}

describe("OpenSkyService", () => {
  it("caches states and estimates the credit cost", async () => {
    const { service, fetchFn } = makeService({ "/api/states/all": () => jsonResponse(fixture("states-all.json")) });
    const box = { lamin: 30, lomin: -120, lamax: 40, lomax: -80 };
    const first = await service.getStates({ box });
    expect(first.cache).toBe("fresh");
    expect(first.estimatedCost).toBe(3); // 10° x 40° = 400 sq°
    const second = await service.getStates({ box });
    expect(second.cache).toBe("cached");
    expect(second.estimatedCost).toBe(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("answers a smaller box from a cached larger one", async () => {
    const { service, fetchFn } = makeService({ "/api/states/all": () => jsonResponse(fixture("states-all.json")) });
    await service.getStates({ box: { lamin: 30, lomin: -120, lamax: 40, lomax: -80 } });
    const inner = await service.getStates({ box: { lamin: 33, lomin: -119, lamax: 34, lomax: -118 } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(inner.value.states.map((s) => s.icao24)).toEqual(["aa8c39"]);
  });

  it("serves stale data with a warning when OpenSky fails", async () => {
    let fail = false;
    const { service, advance } = makeService({
      "/api/states/all": () => (fail ? new Response("", { status: 503 }) : jsonResponse(fixture("states-all.json"))),
    });
    await service.getStates({ icao24: ["aa8c39"] });
    fail = true;
    advance(60_000);
    const result = await service.getStates({ icao24: ["aa8c39"] });
    expect(result.cache).toBe("stale");
    expect(result.warnings.some((w) => w.includes("Showing cached data"))).toBe(true);
  });

  it("rejects windows OpenSky would refuse, before spending credits", async () => {
    const { service, fetchFn } = makeService({});
    const day = 86_400;
    await expect(service.getAllFlights(0, 3 * 3_600)).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(service.getFlightsByAircraft("abc", 0, 3 * day)).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(service.getAirportFlights("arrival", "EDDF", 10, 2 * day + 10)).rejects.toBeInstanceOf(
      InvalidRequestError,
    );
    await expect(service.getTrack("abc", 1)).rejects.toBeInstanceOf(InvalidRequestError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns an empty list for 404 flights", async () => {
    const { service } = makeService({ "/api/flights/departure": () => new Response("", { status: 404 }) });
    const begin = Date.parse("2026-10-21T00:00:00Z") / 1000;
    const result = await service.getAirportFlights("departure", "eddf", begin, begin + 86_399);
    expect(result.value).toEqual([]);
    expect(result.estimatedCost).toBe(30);
  });
});
