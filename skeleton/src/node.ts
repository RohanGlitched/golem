// Node-only entry (golem-spec/node): node pool, CLI helpers, MCP.
export * from './cli/index.js';
export * from './mcp/index.js';
export { createNodePool, defaultNodePoolSize } from './pool/node.js';
export type { NodePoolOptions } from './pool/node.js';
export { nodeFileSystem } from './pool/node-fs.js';
export { physicalCoreCount } from './pool/cores.js';
export { pythonController, defaultPython } from './bridge/python.js';
export type { PythonControllerOptions } from './bridge/python.js';
