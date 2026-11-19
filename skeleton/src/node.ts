// Node-only entry (golem-spec/node): node pool, CLI helpers, MCP.
export * from './cli/index.js';
export * from './mcp/index.js';
export { createNodePool, defaultNodePoolSize } from './pool/node.js';
export type { NodePoolOptions } from './pool/node.js';
export { nodeFileSystem } from './pool/node-fs.js';
