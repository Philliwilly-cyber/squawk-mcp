// stdout is the MCP channel, so everything goes to stderr.
export function logInfo(message: string): void {
  console.error(`[squawk-mcp] ${message}`);
}

export function logWarn(message: string): void {
  console.warn(`[squawk-mcp] warning: ${message}`);
}
