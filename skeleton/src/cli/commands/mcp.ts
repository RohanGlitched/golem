// `golem mcp`: the stdio MCP server. It exits 0 when stdin closes, after closing the pool.
import type { CommandHandler } from '../run.js';

export const handler: CommandHandler = async (p, io, deps) => {
  const { runStdioServer } = await import('../../mcp/server.js');
  return runStdioServer(p, io, deps);
};
