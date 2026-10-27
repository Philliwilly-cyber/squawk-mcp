import { join } from "node:path";
import { CsvParser, headerIndex } from "../../core/csv.js";
import { LazyDataset, type DatasetState } from "../../core/dataset.js";
import { ensureCachedFile, readTextChunks } from "../../core/files.js";
import { type Coordinates, distanceKm } from "../../core/geo.js";
import type { FetchLike } from "../../core/http.js";

export interface Airport {
  ident: string;
  type: string;
  name: string;
  lat: number;
  lon: number;
  elevationFt: number | null;
  country: string;
  region: string;
  municipality: string | null;
  scheduledService: boolean;
  icao: string | null;
  iata: string | null;
  wikipedia: string | null;
}

const TYPE_RANK: Readonly<Record<string, number>> = {
  large_airport: 0,
  medium_airport: 1,
  small_airport: 2,
  heliport: 3,
  seaplane_base: 4,
  balloonport: 5,
  closed: 9,
};

const rank = (airport: Airport): number => TYPE_RANK[airport.type] ?? 6;
const normalize = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export class AirportIndex {
  private readonly byCode = new Map<string, Airport>();

  constructor(readonly airports: readonly Airport[]) {
    // Insert less important airports first so that a code shared with a closed or minor
    // airport resolves to the main one.
    const ordered = [...airports].sort((a, b) => rank(b) - rank(a));
    for (const airport of ordered) {
      this.byCode.set(airport.ident.toUpperCase(), airport);
      if (airport.icao) this.byCode.set(airport.icao.toUpperCase(), airport);
      if (airport.iata) this.byCode.set(airport.iata.toUpperCase(), airport);
    }
  }

  /** Finds an airport by ICAO, IATA or OurAirports ident. */
  lookup(code: string): Airport | undefined {
    return this.byCode.get(code.trim().toUpperCase());
  }

  /** Finds airports by code, name or city; bigger airports first. */
  search(query: string, limit = 10): Airport[] {
    const exact = this.lookup(query);
    const needle = normalize(query.trim());
    if (needle === "") return [];
    const matches = this.airports
      .filter((a) => a !== exact && a.type !== "closed")
      .map((a) => {
        const name = normalize(a.name);
        const city = a.municipality ? normalize(a.municipality) : "";
        let score = -1;
        if (name === needle || city === needle) score = 0;
        else if (name.startsWith(needle) || city.startsWith(needle)) score = 1;
        else if (name.includes(needle) || city.includes(needle)) score = 2;
        return { a, score };
      })
      .filter((m) => m.score >= 0)
      .sort((x, y) => x.score - y.score || rank(x.a) - rank(y.a) || x.a.name.localeCompare(y.a.name))
      .map((m) => m.a);
    return (exact ? [exact, ...matches] : matches).slice(0, limit);
  }

  nearest(point: Coordinates, limit = 5, types: readonly string[] = ["large_airport", "medium_airport"]): Airport[] {
    return this.airports
      .filter((a) => types.includes(a.type))
      .map((a) => ({ a, d: distanceKm(point, { lat: a.lat, lon: a.lon }) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, limit)
      .map((x) => x.a);
  }
}

const optional = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
};

export function parseAirportRows(rows: Iterable<string[]>): Airport[] {
  const airports: Airport[] = [];
  let col: ((name: string) => number) | null = null;
  for (const row of rows) {
    if (!col) {
      col = headerIndex(row);
      continue;
    }
    const get = (name: string): string | undefined => {
      const index = col?.(name) ?? -1;
      return index >= 0 ? row[index] : undefined;
    };
    const lat = Number(get("latitude_deg"));
    const lon = Number(get("longitude_deg"));
    const ident = optional(get("ident"));
    if (!ident || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const elevation = optional(get("elevation_ft"));
    // Newer exports have icao_code; older ones only gps_code, which is usually the ICAO code.
    const gps = optional(get("gps_code"));
    const icao = optional(get("icao_code")) ?? (gps && /^[A-Z]{4}$/.test(gps) ? gps : null);
    airports.push({
      ident,
      type: optional(get("type")) ?? "unknown",
      name: optional(get("name")) ?? ident,
      lat,
      lon,
      elevationFt: elevation === null ? null : Number(elevation),
      country: optional(get("iso_country")) ?? "",
      region: optional(get("iso_region")) ?? "",
      municipality: optional(get("municipality")),
      scheduledService: get("scheduled_service") === "yes",
      icao,
      iata: optional(get("iata_code")),
      wikipedia: optional(get("wikipedia_link")),
    });
  }
  return airports;
}

export interface AirportSourceOptions {
  url: string;
  cacheDir: string;
  userAgent: string;
  fetchFn: FetchLike;
}

const WEEK_MS = 7 * 24 * 60 * 60_000;

/** OurAirports airports.csv, downloaded at most weekly and indexed in memory. */
export class AirportSource {
  private readonly dataset: LazyDataset<AirportIndex>;

  constructor(options: AirportSourceOptions) {
    this.dataset = new LazyDataset(async () => {
      const file = await ensureCachedFile({
        url: options.url,
        path: join(options.cacheDir, "ourairports-airports.csv"),
        maxAgeMs: WEEK_MS,
        userAgent: options.userAgent,
        fetchFn: options.fetchFn,
      });
      const rows: string[][] = [];
      const parser = new CsvParser((row) => rows.push(row));
      for await (const chunk of readTextChunks(file.path)) parser.write(chunk);
      parser.end();
      const index = new AirportIndex(parseAirportRows(rows));
      return file.refreshError === undefined
        ? { data: index, updatedAt: file.updatedAt }
        : { data: index, updatedAt: file.updatedAt, refreshError: file.refreshError };
    });
  }

  start(): void {
    this.dataset.start();
  }

  peek(): DatasetState<AirportIndex> {
    return this.dataset.peek();
  }

  get(waitMs = 30_000): Promise<DatasetState<AirportIndex>> {
    return this.dataset.get(waitMs);
  }
}
