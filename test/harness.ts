import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Throttle } from "../src/core/throttle.js";
import { createServer } from "../src/server.js";
import { AircraftDatabase } from "../src/sources/aircraft-db/aircraft-db.js";
import { Nominatim } from "../src/sources/nominatim/nominatim.js";
import { OpenSkyClient } from "../src/sources/opensky/client.js";
import { OpenSkyService } from "../src/sources/opensky/service.js";
import { AirportSource } from "../src/sources/ourairports/airports.js";
import { noRetry, routeFetch } from "./helpers.js";

export interface Harness {
  client: Client;
  fetchFn: ReturnType<typeof routeFetch>;
  close: () => Promise<void>;
}

/** Starts the full server with mocked upstreams and connects an in-memory MCP client. */
export async function startServer(routes: Parameters<typeof routeFetch>[0], now: Date): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "squawk-server-"));
  const fetchFn = routeFetch(routes);
  const shared = { cacheDir: dir, userAgent: "squawk-mcp/test", fetchFn };
  const opensky = new OpenSkyService(
    new OpenSkyClient({
      baseUrl: "https://opensky.example/api",
      userAgent: "t",
      fetchFn,
      tokens: null,
      retry: noRetry,
      now: () => now.getTime(),
    }),
    () => now.getTime(),
  );
  const server = createServer({
    opensky,
    aircraftDb: new AircraftDatabase({ ...shared, url: "https://data.example/aircraft.csv" }),
    airports: new AirportSource({ ...shared, url: "https://data.example/airports.csv" }),
    geocoder: new Nominatim({ ...shared, baseUrl: "https://nominatim.example", throttle: new Throttle(0) }),
    clock: () => now,
    version: "0.0.0-test",
    cacheDir: dir,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    fetchFn,
    close: async () => {
      await client.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export function resultJson(result: unknown): Record<string, unknown> {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return JSON.parse(content[0]?.text ?? "{}") as Record<string, unknown>;
}
