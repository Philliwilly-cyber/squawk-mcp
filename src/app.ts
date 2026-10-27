import type { Config } from "./config.js";
import type { FetchLike } from "./core/http.js";
import { type Clock, systemClock } from "./core/time.js";
import { AircraftDatabase } from "./sources/aircraft-db/aircraft-db.js";
import { Nominatim } from "./sources/nominatim/nominatim.js";
import { OpenSkyClient } from "./sources/opensky/client.js";
import { OpenSkyService } from "./sources/opensky/service.js";
import { TokenManager } from "./sources/opensky/token.js";
import { AirportSource } from "./sources/ourairports/airports.js";
import type { ToolContext } from "./tools/context.js";

/** Wires all data sources from the configuration. */
export function createContext(config: Config, fetchFn: FetchLike, clock: Clock = systemClock): ToolContext {
  const tokens = config.credentials ? new TokenManager(config.credentials, config.openSkyTokenUrl, fetchFn) : null;
  const opensky = new OpenSkyService(
    new OpenSkyClient({ baseUrl: config.openSkyApiUrl, userAgent: config.userAgent, fetchFn, tokens }),
  );
  const shared = { cacheDir: config.cacheDir, userAgent: config.userAgent, fetchFn };
  return {
    opensky,
    aircraftDb: new AircraftDatabase({ ...shared, url: config.aircraftDbUrl }),
    airports: new AirportSource({ ...shared, url: config.airportsUrl }),
    geocoder: new Nominatim({ ...shared, baseUrl: config.nominatimUrl }),
    clock,
    version: config.version,
    cacheDir: config.cacheDir,
  };
}
