import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EnvelopeBuilder } from "../core/envelope.js";
import { EMERGENCY_CAVEAT, explainSquawk } from "../core/squawk.js";
import type { ToolContext } from "./context.js";
import { NOTE_SQUAWK } from "./notes.js";
import { jsonResult, runTool } from "./result.js";

export function registerExplainSquawk(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "explain_squawk",
    {
      title: "Explain a squawk code",
      description:
        "Explains a transponder (squawk) code in plain language: emergencies 7500/7600/7700, VFR codes like 7000 and 1200, " +
        "and what an ordinary ATC-assigned code means. Offline, no credits.",
      inputSchema: { code: z.string().min(1).max(8).describe("Four-digit squawk code, e.g. 7700") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(() => {
        const builder = new EnvelopeBuilder(ctx.clock()).source("squawk-mcp built-in squawk reference").note(NOTE_SQUAWK);
        builder.note("Some countries allocate further special codes; only internationally common ones are explained specifically.");
        const info = explainSquawk(args.code);
        if (info.category === "emergency") {
          builder.warn(`${info.code} is an emergency code (${info.label}). ${EMERGENCY_CAVEAT}`);
        }
        return Promise.resolve(jsonResult(builder.build(info)));
      }),
  );
}
