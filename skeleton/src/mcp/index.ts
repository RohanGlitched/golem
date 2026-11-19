// Public surface of the MCP server (exported from golem-spec/node).
export { createGolemServer, runStdioServer, defaultTools } from './server.js';
export type { GolemServer, GolemServerOptions, McpAppContext, ToolCtx, ToolDef } from './server.js';
export { TOOL_NAMES, TOOL_SCHEMAS } from './tool-schemas.js';
export { makeToolResult, limitJson } from './result.js';
