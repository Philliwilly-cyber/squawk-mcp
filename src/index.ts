#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContext } from "./app.js";
import { loadConfig } from "./config.js";
import { logInfo } from "./core/log.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const ctx = createContext(config, globalThis.fetch.bind(globalThis));
  const server = createServer(ctx);
  await server.connect(new StdioServerTransport());

  logInfo(`v${config.version} running on stdio, OpenSky auth: ${ctx.opensky.authMode}, cache: ${config.cacheDir}`);
  // Load the datasets in the background so the first lookups are fast.
  ctx.airports.start();
  ctx.aircraftDb.start();
}

main().catch((error: unknown) => {
  console.error("[squawk-mcp] fatal:", error);
  process.exit(1);
});
