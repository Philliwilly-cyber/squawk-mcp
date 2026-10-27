import { type CacheStatus, TtlCache } from "../../core/cache.js";
import { type BoundingBox, boxContainsBox, contains } from "../../core/geo.js";
import { HttpError } from "../../core/http.js";
import { toBerlinIso, utcDayStart } from "../../core/time.js";
import type { OpenSkyAuthMode, OpenSkyClient } from "./client.js";
import { type CreditBucket, LOW_CREDIT_THRESHOLD, historyCost, statesCost } from "./credits.js";
import { parseFlights, parseStates, parseTrack } from "./parse.js";
import type { Flight, StatesSnapshot, Track } from "./types.js";

export interface OpenSkyResult<T> {
  value: T;
  cache: CacheStatus;
  /** When the data was fetched from OpenSky (ms since epoch). */
  fetchedAt: number;
  authMode: OpenSkyAuthMode;
  /** Credits this call would cost when not served from cache (documented tariff). */
  estimatedCost: number;
  /** Last known balance of the bucket this call draws from. */
  creditsRemaining: number | null;
  warnings: string[];
}

export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

interface Cached<T> {
  value: T;
  authMode: OpenSkyAuthMode;
  warnings: string[];
}

export interface StatesQuery {
  box?: BoundingBox;
  icao24?: readonly string[];
}

const MAX_FLIGHTS_AIRCRAFT_S = 2 * 86_400;
const MAX_FLIGHTS_ALL_S = 2 * 3_600;
const MAX_TRACK_AGE_S = 30 * 86_400;
const MAX_STALE_MS = 15 * 60_000;

const roundCoord = (value: number): string => value.toFixed(4);

/** Cached, quota-aware access to OpenSky. Validates time windows before spending credits. */
export class OpenSkyService {
  private readonly states: TtlCache<Cached<StatesSnapshot>>;
  private readonly flights: TtlCache<Cached<Flight[]>>;
  private readonly tracks: TtlCache<Cached<Track | null>>;

  constructor(
    private readonly client: OpenSkyClient,
    private readonly now: () => number = Date.now,
  ) {
    // Match the API's time resolution: 5 s authenticated, 10 s anonymous.
    const statesTtl = client.configuredAuthMode === "oauth2" ? 5_000 : 10_000;
    this.states = new TtlCache({ ttlMs: statesTtl, maxStaleMs: MAX_STALE_MS, maxEntries: 200, now });
    // Flight lists come from a nightly batch, so past days hardly change.
    this.flights = new TtlCache({ ttlMs: 60 * 60_000, maxStaleMs: 24 * 60 * 60_000, maxEntries: 200, now });
    this.tracks = new TtlCache({ ttlMs: 60_000, maxStaleMs: MAX_STALE_MS, maxEntries: 200, now });
  }

  get authMode(): OpenSkyAuthMode {
    return this.client.configuredAuthMode;
  }

  get credits(): OpenSkyClient["credits"] {
    return this.client.credits;
  }

  /** Live state vectors for a bounding box and/or specific transponders. */
  async getStates(query: StatesQuery): Promise<OpenSkyResult<StatesSnapshot>> {
    const icao24 = query.icao24?.map((s) => s.toLowerCase()).sort();
    const box = query.box;
    const cost = statesCost(box ?? null);
    const key = this.statesKey(box, icao24);

    // A fresh answer for a larger box already contains everything in a smaller one.
    if (box && !icao24?.length) {
      const covering = this.findCoveringBox(box);
      if (covering) {
        const states = covering.entry.value.value.states.filter(
          (s) => s.latitude !== null && s.longitude !== null && contains(box, { lat: s.latitude, lon: s.longitude }),
        );
        return this.result(
          { ...covering.entry.value, value: { time: covering.entry.value.value.time, states } },
          "cached",
          covering.entry.storedAt,
          cost,
          "states",
        );
      }
    }

    const cached = await this.states.get(key, async () => {
      const response = await this.client.get(
        "/states/all",
        {
          lamin: box?.lamin,
          lomin: box?.lomin,
          lamax: box?.lamax,
          lomax: box?.lomax,
          icao24,
          extended: 1,
        },
        false,
      );
      return { value: parseStates(response.body), authMode: response.authMode, warnings: response.warnings };
    });
    return this.result(cached.value, cached.status, cached.storedAt, cost, "states", cached.error);
  }

  /** Flights of one aircraft. Nightly batch: only the previous day or earlier. */
  async getFlightsByAircraft(icao24: string, begin: number, end: number): Promise<OpenSkyResult<Flight[]>> {
    this.checkInterval(begin, end, MAX_FLIGHTS_AIRCRAFT_S, "2 days");
    return this.flightsQuery("/flights/aircraft", { icao24: icao24.toLowerCase(), begin, end });
  }

  /** Arrivals at or departures from an airport. Nightly batch: only the previous day or earlier. */
  async getAirportFlights(
    direction: "arrival" | "departure",
    airport: string,
    begin: number,
    end: number,
  ): Promise<OpenSkyResult<Flight[]>> {
    this.checkInterval(begin, end, Number.POSITIVE_INFINITY, "");
    // Matches the official client: begin and end may span at most one UTC day boundary.
    if (utcDayStart(end) - utcDayStart(begin) > 86_400) {
      throw new InvalidRequestError("The interval may span at most one UTC day boundary (e.g. one calendar day).");
    }
    return this.flightsQuery(`/flights/${direction}`, { airport: airport.toUpperCase(), begin, end });
  }

  /** All flights in an interval of at most two hours. */
  async getAllFlights(begin: number, end: number): Promise<OpenSkyResult<Flight[]>> {
    this.checkInterval(begin, end, MAX_FLIGHTS_ALL_S, "2 hours");
    return this.flightsQuery("/flights/all", { begin, end });
  }

  /** Trajectory of an aircraft. time = 0 means the live track. Experimental endpoint. */
  async getTrack(icao24: string, time: number): Promise<OpenSkyResult<Track | null>> {
    const nowS = Math.floor(this.now() / 1000);
    if (time !== 0 && nowS - time > MAX_TRACK_AGE_S) {
      throw new InvalidRequestError("OpenSky does not provide tracks older than 30 days.");
    }
    const id = icao24.toLowerCase();
    const cached = await this.tracks.get(`${id}|${time}`, async () => {
      // The official client uses /tracks/all; the docs also mention /tracks.
      const response = await this.client.get("/tracks/all", { icao24: id, time }, true);
      return {
        value: response.body === null ? null : parseTrack(response.body),
        authMode: response.authMode,
        warnings: response.warnings,
      };
    });
    const cost = time === 0 ? 4 : historyCost(time, time, nowS);
    return this.result(cached.value, cached.status, cached.storedAt, cost, "tracks", cached.error);
  }

  private async flightsQuery(
    path: string,
    query: Record<string, string | number>,
  ): Promise<OpenSkyResult<Flight[]>> {
    const begin = Number(query["begin"]);
    const end = Number(query["end"]);
    const key = `${path}|${Object.entries(query)
      .map(([k, v]) => `${k}=${v}`)
      .join("&")}`;
    const cached = await this.flights.get(key, async () => {
      const response = await this.client.get(path, query, true);
      return { value: parseFlights(response.body), authMode: response.authMode, warnings: response.warnings };
    });
    const cost = historyCost(begin, end, Math.floor(this.now() / 1000));
    return this.result(cached.value, cached.status, cached.storedAt, cost, "flights", cached.error);
  }

  private checkInterval(begin: number, end: number, maxSeconds: number, label: string): void {
    if (!Number.isInteger(begin) || !Number.isInteger(end)) throw new InvalidRequestError("begin and end must be Unix seconds");
    if (end <= begin) throw new InvalidRequestError("end must be after begin");
    if (end - begin > maxSeconds) throw new InvalidRequestError(`The interval must not be longer than ${label}.`);
  }

  private statesKey(box: BoundingBox | undefined, icao24: readonly string[] | undefined): string {
    const boxPart = box ? [box.lamin, box.lomin, box.lamax, box.lomax].map(roundCoord).join(",") : "global";
    return `${boxPart}|${icao24?.join(",") ?? ""}`;
  }

  private findCoveringBox(
    box: BoundingBox,
  ): { entry: { value: Cached<StatesSnapshot>; storedAt: number } } | undefined {
    for (const [key, entry] of this.states.freshEntries()) {
      const [boxPart, ids] = key.split("|");
      if (ids !== "" || boxPart === undefined) continue;
      if (boxPart === "global") return { entry };
      const [lamin, lomin, lamax, lomax] = boxPart.split(",").map(Number);
      if (lamin === undefined || lomin === undefined || lamax === undefined || lomax === undefined) continue;
      if (boxContainsBox({ lamin, lomin, lamax, lomax }, box)) return { entry };
    }
    return undefined;
  }

  private result<T>(
    cached: Cached<T>,
    status: CacheStatus,
    storedAt: number,
    cost: number,
    bucket: CreditBucket,
    error?: unknown,
  ): OpenSkyResult<T> {
    const warnings = [...cached.warnings];
    if (status === "stale") {
      const reason = error instanceof Error ? error.message : "OpenSky is unavailable";
      const ageS = Math.round((this.now() - storedAt) / 1000);
      warnings.push(`${reason} Showing cached data from ${toBerlinIso(new Date(storedAt))} (${ageS} s old) instead.`);
    }
    const balance = this.client.credits.get(bucket);
    if (balance && balance.remaining < LOW_CREDIT_THRESHOLD) {
      warnings.push(`Only ${balance.remaining} OpenSky credits left for /${bucket} today.`);
    }
    return {
      value: cached.value,
      cache: status,
      fetchedAt: storedAt,
      authMode: cached.authMode,
      estimatedCost: status === "fresh" ? cost : 0,
      creditsRemaining: balance?.remaining ?? null,
      warnings,
    };
  }
}

export function isQuotaError(error: unknown): boolean {
  return error instanceof HttpError && error.status === 429;
}
