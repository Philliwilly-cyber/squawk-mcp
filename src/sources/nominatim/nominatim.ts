import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BoundingBox } from "../../core/geo.js";
import { type FetchLike, HttpError, fetchWithTimeout, parseRetryAfter } from "../../core/http.js";
import { logWarn } from "../../core/log.js";
import { type RetryOptions, withRetry } from "../../core/retry.js";
import { Throttle } from "../../core/throttle.js";

export interface Place {
  lat: number;
  lon: number;
  displayName: string;
  /** OSM class and type, e.g. "place" / "city". */
  category: string;
  type: string;
  boundingBox: BoundingBox | null;
}

interface CacheEntry {
  place: Place | null;
  storedAt: number;
}

export interface GeocodeResult {
  place: Place | null;
  cached: boolean;
  storedAt: number;
}

export interface NominatimOptions {
  baseUrl: string;
  userAgent: string;
  cacheDir: string;
  fetchFn: FetchLike;
  now?: () => number;
  throttle?: Throttle;
  retry?: RetryOptions;
}

const CACHE_TTL_MS = 30 * 24 * 60 * 60_000;
/** A few slow retries on 429/5xx; giving up after ~10 s is better than hammering a volunteer service. */
const NOMINATIM_RETRY: RetryOptions = { retries: 2, baseDelayMs: 2_000, maxDelayMs: 5_000, maxTotalWaitMs: 10_000 };
const MAX_CACHE_ENTRIES = 5_000;

const normalizeQuery = (query: string): string => query.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Geocoding via Nominatim, following the OSMF usage policy: at most one request per
 * second, an identifying User-Agent, and results cached so repeated questions do not
 * hit the service again.
 */
export class Nominatim {
  private readonly throttle: Throttle;
  private readonly now: () => number;
  private readonly cachePath: string;
  private cache: Promise<Map<string, CacheEntry>> | null = null;
  private readonly inFlight = new Map<string, Promise<GeocodeResult>>();

  constructor(private readonly options: NominatimOptions) {
    this.now = options.now ?? Date.now;
    this.throttle = options.throttle ?? new Throttle(1_100, this.now);
    this.cachePath = join(options.cacheDir, "nominatim-cache.json");
  }

  async geocode(query: string): Promise<GeocodeResult> {
    const key = normalizeQuery(query);
    if (key === "") return { place: null, cached: false, storedAt: this.now() };

    const cache = await this.loadCache();
    const hit = cache.get(key);
    if (hit && this.now() - hit.storedAt < CACHE_TTL_MS) {
      return { place: hit.place, cached: true, storedAt: hit.storedAt };
    }

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    // Retries stay inside the throttle, so they never exceed one request per second either.
    const promise = this.throttle
      .run(() => withRetry(() => this.request(query), this.options.retry ?? NOMINATIM_RETRY))
      .then(async (place) => {
        const storedAt = this.now();
        cache.set(key, { place, storedAt });
        await this.saveCache(cache);
        return { place, cached: false, storedAt };
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  private async request(query: string): Promise<Place | null> {
    // Relative to the base so that a path prefix (self-hosted instance) is kept.
    const base = this.options.baseUrl.endsWith("/") ? this.options.baseUrl : `${this.options.baseUrl}/`;
    const url = new URL("search", base);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    const response = await fetchWithTimeout(
      this.options.fetchFn,
      url,
      { headers: { "User-Agent": this.options.userAgent, "Accept-Language": "en,de" } },
      15_000,
    );
    if (response.status === 429) {
      throw new HttpError(
        "Nominatim (OpenStreetMap geocoding) is rate-limiting requests from this IP (429).",
        429,
        parseRetryAfter(response.headers.get("Retry-After")),
      );
    }
    if (!response.ok) {
      throw new HttpError(`Nominatim answered ${response.status}`, response.status);
    }
    const results = (await response.json());
    if (!Array.isArray(results) || results.length === 0) return null;
    return parsePlace(results[0]);
  }

  /** Loads the persistent cache once; concurrent callers share the same Map. */
  private loadCache(): Promise<Map<string, CacheEntry>> {
    this.cache ??= readFile(this.cachePath, "utf8").then(
      (text) => new Map(Object.entries(JSON.parse(text) as Record<string, CacheEntry>)),
      () => new Map<string, CacheEntry>(),
    );
    return this.cache;
  }

  private async saveCache(cache: Map<string, CacheEntry>): Promise<void> {
    while (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    try {
      await mkdir(dirname(this.cachePath), { recursive: true });
      const temp = `${this.cachePath}.tmp`;
      await writeFile(temp, JSON.stringify(Object.fromEntries(cache)));
      await rename(temp, this.cachePath);
    } catch (error) {
      // The in-memory cache still works; only persistence across restarts is lost.
      logWarn(`could not write geocoding cache: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function parsePlace(raw: unknown): Place | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const lat = Number(r["lat"]);
  const lon = Number(r["lon"]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Nominatim's boundingbox is [south, north, west, east] as strings.
  const bb = Array.isArray(r["boundingbox"]) ? r["boundingbox"].map(Number) : [];
  const [south, north, west, east] = bb;
  const boundingBox =
    south !== undefined && north !== undefined && west !== undefined && east !== undefined && bb.every(Number.isFinite)
      ? { lamin: south, lamax: north, lomin: west, lomax: east }
      : null;
  return {
    lat,
    lon,
    displayName: typeof r["display_name"] === "string" ? r["display_name"] : `${lat}, ${lon}`,
    category: typeof r["category"] === "string" ? r["category"] : typeof r["class"] === "string" ? r["class"] : "",
    type: typeof r["type"] === "string" ? r["type"] : "",
    boundingBox,
  };
}
