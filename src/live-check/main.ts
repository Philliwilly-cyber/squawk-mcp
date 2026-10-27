/**
 * Live check: runs the real tools against the live services and reports what they
 * cost and return. Meant to be run on your own machine (OpenSky may block cloud IPs).
 *
 *   npm run live-check -- [--place Hamburg] [--history] [--record test/fixtures/live]
 *
 * --history also runs the nightly-batch tools (about 60 extra /flights credits).
 * --record saves the raw OpenSky and Nominatim responses as fixtures (never tokens).
 */
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createContext } from "../app.js";
import { loadConfig } from "../config.js";
import type { FetchLike } from "../core/http.js";
import { createServer } from "../server.js";
import { type Recording, recordingFetch } from "./recorder.js";

type Bucket = "states" | "flights" | "tracks";

interface StepResult {
  step: string;
  bucket: Bucket | null;
  ok: boolean;
  summary: string;
  remaining: number | null;
  estimated: number | null;
}

type Json = Record<string, unknown>;

const { values: args } = parseArgs({
  options: {
    place: { type: "string", default: "Hamburg" },
    history: { type: "boolean", default: false },
    record: { type: "string" },
    "db-wait": { type: "string", default: "300" },
  },
});

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);
}

function get(object: unknown, ...path: (string | number)[]): unknown {
  let current = object;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

function quotaOf(data: unknown): { remaining: number | null; estimated: number | null } {
  const quota = get(data, "quota");
  const single = (q: unknown): { remaining: number | null; estimated: number | null } => ({
    remaining: typeof get(q, "remaining_today") === "number" ? (get(q, "remaining_today") as number) : null,
    estimated: typeof get(q, "estimated_cost") === "number" ? (get(q, "estimated_cost") as number) : null,
  });
  if (get(quota, "estimated_cost") !== undefined) return single(quota);
  // airport_traffic reports per direction
  const first = Object.values((quota ?? {}) as Json)[0];
  return single(first);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const recordings: Recording[] = [];
  let fetchFn: FetchLike = globalThis.fetch.bind(globalThis);
  if (args.record) fetchFn = recordingFetch(fetchFn, args.record, recordings);

  const ctx = createContext(config, fetchFn);
  ctx.airports.start();
  ctx.aircraftDb.start();
  const server = createServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "squawk-live-check", version: config.version });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const results: StepResult[] = [];
  const call = async (step: string, name: string, toolArgs: Json, bucket: Bucket | null = null): Promise<Json | null> => {
    process.stderr.write(`→ ${step} ... `);
    const response = await client.callTool({ name, arguments: toolArgs });
    const content = (response.content as { type: string; text: string }[])[0];
    const json = JSON.parse(content?.text ?? "{}") as Json;
    if (response.isError) {
      process.stderr.write("error\n");
      results.push({
        step,
        bucket,
        ok: false,
        summary: `${text(json["error"])}${json["hint"] ? ` (${text(json["hint"])})` : ""}`,
        remaining: null,
        estimated: null,
      });
      return null;
    }
    process.stderr.write("ok\n");
    const data = json["data"];
    const warnings = (json["warnings"] as string[] | undefined) ?? [];
    const age = json["data_age_seconds"];
    results.push({
      step,
      bucket,
      ok: true,
      summary: `age ${age === null ? "-" : `${text(age)} s`}, cache ${text(json["cache"])}, auth ${text(json["auth_mode"])}, ${warnings.length} warning(s)`,
      ...quotaOf(data),
    });
    return json;
  };

  await call("service_status", "service_status", {});
  await call("airport_info EDDH (OurAirports download)", "airport_info", { query: "EDDH", limit: 1 });

  const overhead = await call(`flights_overhead ${args.place} (Nominatim + /states/all)`, "flights_overhead", {
    place: args.place,
    radius_km: 40,
  }, "states");
  const center = { lat: Number(get(overhead, "data", "location", "lat")), lon: Number(get(overhead, "data", "location", "lon")) };
  // A second, separate 1-credit box to see how X-Rate-Limit-Remaining moves.
  if (Number.isFinite(center.lat)) {
    await call("flights_overhead, box 1° further north", "flights_overhead", {
      lat: center.lat + 1,
      lon: center.lon,
      radius_km: 40,
    }, "states");
  }

  const aircraft = (get(overhead, "data", "aircraft") as Json[] | undefined) ?? [];
  const icao24 = typeof aircraft[0]?.["icao24"] === "string" ? aircraft[0]["icao24"] : null;
  if (icao24) {
    await call(`aircraft_lookup ${icao24} live (icao24-only /states/all)`, "aircraft_lookup", {
      query: icao24,
      kind: "icao24",
    }, "states");
    await call(`aircraft_track ${icao24} live (/tracks/all)`, "aircraft_track", { aircraft: icao24, max_waypoints: 20 }, "tracks");
    if (args.history) {
      await call(`aircraft_flight_history ${icao24} yesterday`, "aircraft_flight_history", { aircraft: icao24 }, "flights");
    }
  } else {
    process.stderr.write("No aircraft overhead; skipping the aircraft steps.\n");
  }
  if (args.history) {
    await call("airport_traffic EDDH arrivals yesterday", "airport_traffic", { airport: "EDDH" }, "flights");
  }

  const dbWaitMs = Number(args["db-wait"]) * 1000;
  process.stderr.write(`→ waiting up to ${dbWaitMs / 1000} s for the aircraft database ... `);
  const db = await ctx.aircraftDb.get(dbWaitMs);
  process.stderr.write(`${db.status}\n`);
  const registration = icao24 && db.status === "ready" ? db.data.byIcao24(icao24)?.registration : null;
  if (registration) {
    await call(`aircraft_lookup ${registration} (aircraft database, no credits)`, "aircraft_lookup", {
      query: registration,
      live: false,
    });
  }
  await call("service_status (final)", "service_status", {});
  await client.close();

  // Report
  console.log(`\nsquawk-mcp ${config.version} live check, OpenSky auth: ${ctx.opensky.authMode}\n`);
  const previous = new Map<Bucket, number>();
  for (const r of results) {
    let spent = "";
    const before = r.bucket ? previous.get(r.bucket) : undefined;
    if (r.remaining !== null && before !== undefined && r.estimated !== null && r.estimated > 0) {
      spent = `, measured ${before - r.remaining} credit(s) vs. estimated ${r.estimated}`;
    }
    const remaining = r.remaining === null ? "" : `, ${r.bucket ?? "?"} credits remaining ${r.remaining}`;
    console.log(`${r.ok ? "✔" : "✘"} ${r.step}\n    ${r.summary}${remaining}${spent}`);
    if (r.bucket && r.remaining !== null) previous.set(r.bucket, r.remaining);
  }
  console.log(
    `\nAircraft database: ${db.status === "ready" ? `${db.data.size} aircraft from ${config.aircraftDbUrl}` : db.status === "failed" ? `FAILED (${db.error}) from ${config.aircraftDbUrl}` : "still loading"}`,
  );
  if (recordings.length > 0) {
    console.log(`\nRecorded ${recordings.length} response(s):`);
    for (const r of recordings) console.log(`  ${r.status} ${r.file}`);
  }
  console.log(
    "\nNote: 'measured' compares X-Rate-Limit-Remaining with the previous step on the same endpoint group. " +
      "Other OpenSky use from your IP or account in between distorts it.",
  );
}

main().catch((error: unknown) => {
  console.error("live check failed:", error);
  process.exit(1);
});
