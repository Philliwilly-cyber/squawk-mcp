import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EnvelopeBuilder } from "../core/envelope.js";
import { type BoundingBox, boxAreaSqDeg, validateBox } from "../core/geo.js";
import { statesCost } from "../sources/opensky/credits.js";
import type { ToolContext } from "./context.js";
import { liveStates } from "./live.js";
import { resolveLocation } from "./resolve.js";
import { ToolInputError, jsonResult, runTool } from "./result.js";

export const AREA_SCHEMA = {
  place: z
    .string()
    .optional()
    .describe('Region name whose OpenStreetMap bounding box is used, e.g. "Bayern" or "Germany"'),
  lamin: z.number().min(-90).max(90).optional().describe("Southern latitude of the box"),
  lomin: z.number().min(-180).max(180).optional().describe("Western longitude of the box"),
  lamax: z.number().min(-90).max(90).optional().describe("Northern latitude of the box"),
  lomax: z.number().min(-180).max(180).optional().describe("Eastern longitude of the box"),
  allow_large_area: z
    .boolean()
    .default(false)
    .describe("Allow boxes over 25 sq°, which cost 2-4 OpenSky credits instead of 1"),
};

export interface AreaArgs {
  place?: string | undefined;
  lamin?: number | undefined;
  lomin?: number | undefined;
  lamax?: number | undefined;
  lomax?: number | undefined;
  allow_large_area: boolean;
}

/** Resolves the area arguments to a box and enforces the credit rule for large boxes. */
export async function resolveArea(ctx: ToolContext, builder: EnvelopeBuilder, args: AreaArgs): Promise<{ box: BoundingBox; label: string }> {
  let box: BoundingBox;
  let label: string;
  const { lamin, lomin, lamax, lomax } = args;
  if (lamin !== undefined && lomin !== undefined && lamax !== undefined && lomax !== undefined) {
    box = { lamin, lomin, lamax, lomax };
    label = "custom box";
  } else if (args.place) {
    const location = await resolveLocation(ctx, builder, { place: args.place });
    if (!location.boundingBox) throw new ToolInputError(`OpenStreetMap has no area outline for "${args.place}".`);
    box = location.boundingBox;
    label = location.label;
  } else {
    throw new ToolInputError("Give a place or all four of lamin, lomin, lamax, lomax.");
  }
  const invalid = validateBox(box);
  if (invalid) throw new ToolInputError(invalid);

  const cost = statesCost(box);
  const area = Math.round(boxAreaSqDeg(box));
  if (cost > 1 && !args.allow_large_area) {
    throw new ToolInputError(
      `The area is ${area} sq° and would cost ${cost} OpenSky credits instead of 1.`,
      "Set allow_large_area to true if that is intended, or use a smaller area (25 sq° or less, about 500 x 300 km in Central Europe).",
    );
  }
  if (cost > 1) builder.warn(`Large area (${area} sq°): this request costs ${cost} OpenSky credits.`);
  return { box, label };
}

export function registerFlightsInArea(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "flights_in_area",
    {
      title: "Aircraft in an area",
      description:
        "Live aircraft inside a bounding box or a named region (e.g. a federal state or country), highest first. " +
        "Boxes up to 25 sq° cost 1 OpenSky credit; larger ones need allow_large_area.",
      inputSchema: {
        ...AREA_SCHEMA,
        include_on_ground: z.boolean().default(false),
        max_results: z.number().int().min(1).max(500).default(50),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(async () => {
        const builder = new EnvelopeBuilder(ctx.clock());
        const area = await resolveArea(ctx, builder, args);
        const live = await liveStates(ctx, builder, {
          box: area.box,
          includeOnGround: args.include_on_ground,
          maxResults: args.max_results,
        });
        return jsonResult(builder.build({ area: { name: area.label, ...area.box }, ...live }));
      }),
  );
}
