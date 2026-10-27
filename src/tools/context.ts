import type { Clock } from "../core/time.js";
import type { AircraftDatabase } from "../sources/aircraft-db/aircraft-db.js";
import type { Nominatim } from "../sources/nominatim/nominatim.js";
import type { OpenSkyService } from "../sources/opensky/service.js";
import type { AirportSource } from "../sources/ourairports/airports.js";

export interface ToolContext {
  opensky: OpenSkyService;
  aircraftDb: AircraftDatabase;
  airports: AirportSource;
  geocoder: Nominatim;
  clock: Clock;
  version: string;
  cacheDir: string;
}
