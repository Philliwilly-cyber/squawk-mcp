import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { squawkReference } from "./core/squawk.js";
import type { ToolContext } from "./tools/context.js";
import { registerAircraftFlightHistory } from "./tools/aircraft-flight-history.js";
import { registerAircraftLookup } from "./tools/aircraft-lookup.js";
import { registerAircraftTrack } from "./tools/aircraft-track.js";
import { registerAirportInfo } from "./tools/airport-info.js";
import { registerAirportTraffic } from "./tools/airport-traffic.js";
import { registerEmergencySquawks } from "./tools/emergency-squawks.js";
import { registerExplainSquawk } from "./tools/explain-squawk.js";
import { registerFlightsInArea } from "./tools/flights-in-area.js";
import { registerFlightsOverhead } from "./tools/flights-overhead.js";
import { registerServiceStatus } from "./tools/service-status.js";

const INSTRUCTIONS = `squawk-mcp answers "what's flying overhead?" with live OpenSky Network data.
- For "right now" questions use flights_overhead, flights_in_area, aircraft_lookup or airport_traffic (mode live_nearby).
- Past flights (aircraft_flight_history, airport_traffic history) come from a nightly batch: yesterday or earlier only.
- Every result has data_age_seconds, coverage_notes and warnings. Pass the important ones on to the user, especially
  missing coverage and emergency squawks, and do not present a squawk 7500/7600/7700 as a confirmed incident.
- OpenSky credits are limited: prefer small areas, and avoid worldwide searches unless asked.`;

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "squawk-mcp", version: ctx.version }, { instructions: INSTRUCTIONS });

  registerFlightsOverhead(server, ctx);
  registerFlightsInArea(server, ctx);
  registerAircraftLookup(server, ctx);
  registerAircraftTrack(server, ctx);
  registerAircraftFlightHistory(server, ctx);
  registerAirportTraffic(server, ctx);
  registerAirportInfo(server, ctx);
  registerEmergencySquawks(server, ctx);
  registerExplainSquawk(server, ctx);
  registerServiceStatus(server, ctx);

  server.registerResource(
    "squawk-codes",
    "squawk://reference/codes",
    {
      title: "Squawk code reference",
      description: "Transponder codes with a specific meaning, explained in plain language",
      mimeType: "application/json",
    },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(squawkReference(), null, 2) }],
    }),
  );

  return server;
}
