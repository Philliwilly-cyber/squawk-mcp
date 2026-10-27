#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { logInfo } from "./core/log.js";
import { systemClock } from "./core/time.js";
import { createServer } from "./server.js";
import { AircraftDatabase } from "./sources/aircraft-db/aircraft-db.js";
import { Nominatim } from "./sources/nominatim/nominatim.js";
import { OpenSkyClient } from "./sources/opensky/client.js";
import { OpenSkyService } from "./sources/opensky/service.js";
import { TokenManager } from "./sources/opensky/token.js";
import { AirportSource } from "./sources/ourairports/airports.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const fetchFn = globalThis.fetch.bind(globalThis);

  const tokens = config.credentials ? new TokenManager(config.credentials, config.openSkyTokenUrl, fetchFn) : null;
  const opensky = new OpenSkyService(
    new OpenSkyClient({ baseUrl: config.openSkyApiUrl, userAgent: config.userAgent, fetchFn, tokens }),
  );
  const shared = { cacheDir: config.cacheDir, userAgent: config.userAgent, fetchFn };
  const aircraftDb = new AircraftDatabase({ ...shared, url: config.aircraftDbUrl });
  const airports = new AirportSource({ ...shared, url: config.airportsUrl });
  const geocoder = new Nominatim({ ...shared, baseUrl: config.nominatimUrl });

  const server = createServer({
    opensky,
    aircraftDb,
    airports,
    geocoder,
    clock: systemClock,
    version: config.version,
    cacheDir: config.cacheDir,
  });
  await server.connect(new StdioServerTransport());

  logInfo(`v${config.version} running on stdio, OpenSky auth: ${opensky.authMode}, cache: ${config.cacheDir}`);
  // Load the datasets in the background so the first lookups are fast.
  airports.start();
  aircraftDb.start();
}

main().catch((error: unknown) => {
  console.error("[squawk-mcp] fatal:", error);
  process.exit(1);
});
