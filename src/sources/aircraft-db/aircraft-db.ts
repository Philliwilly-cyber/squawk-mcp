import { open } from "node:fs/promises";
import { join } from "node:path";
import { CsvParser, headerIndex } from "../../core/csv.js";
import { LazyDataset, type DatasetState } from "../../core/dataset.js";
import { ensureCachedFile, readTextChunks } from "../../core/files.js";
import type { FetchLike } from "../../core/http.js";

export interface AircraftInfo {
  icao24: string;
  registration: string | null;
  manufacturer: string | null;
  model: string | null;
  typecode: string | null;
  icaoAircraftClass: string | null;
  operator: string | null;
  operatorCallsign: string | null;
  operatorIcao: string | null;
  built: string | null;
  category: string | null;
}

/**
 * Columns we keep, with the header names used by the different export formats.
 * The owner column is deliberately left out: for private aircraft it often names a person.
 */
const FIELDS = {
  registration: ["registration"],
  manufacturer: ["manufacturername"],
  model: ["model"],
  typecode: ["typecode"],
  icaoAircraftClass: ["icaoaircraftclass", "icaoaircrafttype"],
  operator: ["operator"],
  operatorCallsign: ["operatorcallsign"],
  operatorIcao: ["operatoricao"],
  built: ["built"],
  category: ["categorydescription"],
} as const satisfies Record<Exclude<keyof AircraftInfo, "icao24">, readonly string[]>;

type FieldName = keyof typeof FIELDS;
const FIELD_NAMES = Object.keys(FIELDS) as FieldName[];
const SEPARATOR = "\u001f";

export const normalizeRegistration = (reg: string): string => reg.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * In-memory index. Each aircraft is stored as one joined string to keep memory low
 * (the database has several hundred thousand rows); it is split on lookup.
 */
export class AircraftIndex {
  private readonly byIcao = new Map<string, string>();
  private readonly byRegistration = new Map<string, string>();

  add(icao24: string, values: readonly (string | null)[]): void {
    const id = icao24.trim().toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(id)) return;
    this.byIcao.set(id, values.map((v) => v ?? "").join(SEPARATOR));
    const registrationIndex = FIELD_NAMES.indexOf("registration");
    const registration = values[registrationIndex];
    if (registration) this.byRegistration.set(normalizeRegistration(registration), id);
  }

  get size(): number {
    return this.byIcao.size;
  }

  byIcao24(icao24: string): AircraftInfo | undefined {
    const id = icao24.trim().toLowerCase();
    const packed = this.byIcao.get(id);
    if (packed === undefined) return undefined;
    const parts = packed.split(SEPARATOR);
    const info: Record<string, string | null> = { icao24: id };
    FIELD_NAMES.forEach((name, i) => {
      const value = parts[i]?.trim();
      info[name] = value === undefined || value === "" ? null : value;
    });
    return info as unknown as AircraftInfo;
  }

  byRegistrationMark(registration: string): AircraftInfo | undefined {
    const id = this.byRegistration.get(normalizeRegistration(registration));
    return id === undefined ? undefined : this.byIcao24(id);
  }
}

/** Returns a function that adds one data row to the index, using the column layout of the header. */
export function rowIndexer(header: readonly string[], index: AircraftIndex): (row: readonly string[]) => void {
  const col = headerIndex(header);
  const icaoColumn = col("icao24");
  if (icaoColumn < 0) throw new Error("Aircraft database has no icao24 column");
  const fieldColumns = FIELD_NAMES.map((name) => FIELDS[name].map(col).find((i) => i >= 0) ?? -1);
  return (row) => {
    const icao = row[icaoColumn];
    if (icao !== undefined) index.add(icao, fieldColumns.map((i) => (i >= 0 ? (row[i] ?? null) : null)));
  };
}

/** Builds an index from CSV rows (first row is the header). */
export function indexRows(rows: readonly string[][]): AircraftIndex {
  const index = new AircraftIndex();
  const [header, ...data] = rows;
  if (header === undefined) return index;
  const add = rowIndexer(header, index);
  for (const row of data) add(row);
  return index;
}

async function detectQuote(path: string): Promise<string> {
  const handle = await open(path, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(1), 0, 1, 0);
    return bytesRead === 1 && buffer.toString("utf8") === "'" ? "'" : '"';
  } finally {
    await handle.close();
  }
}

export interface AircraftDbOptions {
  url: string;
  cacheDir: string;
  userAgent: string;
  fetchFn: FetchLike;
}

const MONTH_MS = 30 * 24 * 60 * 60_000;

/** OpenSky aircraft database: downloaded at most monthly, streamed into an index. */
export class AircraftDatabase {
  private readonly dataset: LazyDataset<AircraftIndex>;

  constructor(options: AircraftDbOptions) {
    this.dataset = new LazyDataset(async () => {
      const file = await ensureCachedFile({
        url: options.url,
        path: join(options.cacheDir, "opensky-aircraft-database.csv"),
        maxAgeMs: MONTH_MS,
        userAgent: options.userAgent,
        fetchFn: options.fetchFn,
      });
      const quote = await detectQuote(file.path);
      const index = new AircraftIndex();
      let add: ((row: readonly string[]) => void) | null = null;
      const parser = new CsvParser((row) => {
        if (add === null) add = rowIndexer(row, index);
        else add(row);
      }, quote);
      for await (const chunk of readTextChunks(file.path)) parser.write(chunk);
      parser.end();
      return file.refreshError === undefined
        ? { data: index, updatedAt: file.updatedAt }
        : { data: index, updatedAt: file.updatedAt, refreshError: file.refreshError };
    });
  }

  start(): void {
    this.dataset.start();
  }

  get(waitMs = 2_000): Promise<DatasetState<AircraftIndex>> {
    return this.dataset.get(waitMs);
  }
}
