import type { CacheStatus } from "./cache.js";
import { toBerlinIso } from "./time.js";

export type AuthMode = "oauth2" | "anonymous" | "not_applicable";

export const OPENSKY_ATTRIBUTION =
  "Flight data: The OpenSky Network, https://opensky-network.org (Schäfer et al., " +
  '"Bringing Up OpenSky: A Large-scale ADS-B Sensor Network for Research", IPSN 2014). ' +
  "Research and non-commercial use only.";
export const OSM_ATTRIBUTION = "Geocoding: Nominatim, © OpenStreetMap contributors (ODbL).";
export const OURAIRPORTS_ATTRIBUTION = "Airport data: OurAirports (public domain), https://ourairports.com";
export const AIRCRAFT_DB_ATTRIBUTION = "Aircraft metadata: OpenSky Network aircraft database.";

export interface Envelope<T> {
  source: string[];
  server_time: string;
  data_time: string | null;
  data_age_seconds: number | null;
  auth_mode: AuthMode;
  cache: CacheStatus;
  coverage_notes: string[];
  warnings: string[];
  attribution: string[];
  data: T;
}

const CACHE_RANK: Record<CacheStatus, number> = { fresh: 0, cached: 1, stale: 2 };

/** Collects the metadata every tool result must carry. */
export class EnvelopeBuilder {
  private readonly sources = new Set<string>();
  private readonly notes = new Set<string>();
  private readonly warningList = new Set<string>();
  private readonly attributions = new Set<string>();
  private cache: CacheStatus = "fresh";
  private dataTimeMs: number | null = null;
  private auth: AuthMode = "not_applicable";

  constructor(private readonly now: Date) {}

  source(name: string): this {
    this.sources.add(name);
    return this;
  }

  note(text: string): this {
    this.notes.add(text);
    return this;
  }

  warn(text: string): this {
    this.warningList.add(text);
    return this;
  }

  attribute(text: string): this {
    this.attributions.add(text);
    return this;
  }

  authMode(mode: AuthMode): this {
    this.auth = mode;
    return this;
  }

  /** Records a cache status; the worst one across all sources wins. */
  cacheStatus(status: CacheStatus): this {
    if (CACHE_RANK[status] > CACHE_RANK[this.cache]) this.cache = status;
    return this;
  }

  /** Records when the data refers to; the oldest one across all sources wins. */
  dataTime(timeMs: number): this {
    if (this.dataTimeMs === null || timeMs < this.dataTimeMs) this.dataTimeMs = timeMs;
    return this;
  }

  hasWarnings(): boolean {
    return this.warningList.size > 0;
  }

  build<T>(data: T): Envelope<T> {
    return {
      source: [...this.sources],
      server_time: toBerlinIso(this.now),
      data_time: this.dataTimeMs === null ? null : toBerlinIso(new Date(this.dataTimeMs)),
      data_age_seconds:
        this.dataTimeMs === null ? null : Math.max(0, Math.round((this.now.getTime() - this.dataTimeMs) / 1000)),
      auth_mode: this.auth,
      cache: this.cache,
      coverage_notes: [...this.notes],
      warnings: [...this.warningList],
      attribution: [...this.attributions],
      data,
    };
  }
}
