import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { EnvelopeBuilder } from "../core/envelope.js";
import type { DatasetState } from "../core/dataset.js";
import { toBerlinIso } from "../core/time.js";
import type { ToolContext } from "./context.js";
import { jsonResult, runTool } from "./result.js";

function datasetStatus<T>(state: DatasetState<T>, size: (data: T) => number): Record<string, unknown> {
  if (state.status === "ready") {
    return {
      status: "ready",
      entries: size(state.data),
      local_copy_from: toBerlinIso(new Date(state.updatedAt)),
      ...(state.refreshError ? { refresh_error: state.refreshError } : {}),
    };
  }
  return state.status === "loading" ? { status: "loading" } : { status: "failed", error: state.error };
}

export function registerServiceStatus(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "service_status",
    {
      title: "squawk-mcp status",
      description:
        "Shows the OpenSky auth mode, the last known remaining credits per endpoint group, the state of the local " +
        "aircraft and airport databases, and the API limits. Makes no API calls.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      runTool(async () => {
        const builder = new EnvelopeBuilder(ctx.clock()).source("squawk-mcp").authMode(ctx.opensky.authMode);
        if (ctx.opensky.authMode === "anonymous") {
          builder.warn("Anonymous mode: set OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET for 10x the credits and 5 s resolution.");
        }
        const credits = Object.fromEntries(
          Object.entries(ctx.opensky.credits.snapshot()).map(([bucket, balance]) => [
            bucket,
            { remaining: balance.remaining, observed_at: toBerlinIso(new Date(balance.observedAt)) },
          ]),
        );
        builder.note("Credit balances are only known after the first request to each endpoint group in this session.");
        return jsonResult(
          builder.build({
            version: ctx.version,
            opensky: {
              auth_mode: ctx.opensky.authMode,
              credits_remaining: credits,
              daily_quota_per_group: ctx.opensky.authMode === "oauth2" ? "4,000 (8,000 for active feeders)" : 400,
              cost: {
                states: "1 credit up to 25 sq°, 2 up to 100, 3 up to 400, 4 above or worldwide",
                flights_and_tracks: "4 for the last 24 h, 30 for 1-2 days, more for longer ranges",
              },
            },
            aircraft_database: datasetStatus(await ctx.aircraftDb.get(0), (index) => index.size),
            airports: datasetStatus(await ctx.airports.get(0), (index) => index.airports.length),
            cache_dir: ctx.cacheDir,
          }),
        );
      }),
  );
}
