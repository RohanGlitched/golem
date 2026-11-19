// Public surface of the kit CLI (exported from golem-spec/node).
export { main } from './run.js';
export { createDefaultDeps, TraceUnavailableError } from './deps.js';
export type { CliIo, KitDeps, KitFs } from './deps.js';
export { parseArgs, formatArgs, ArgError, COMMANDS } from './args.js';
export { locateApp, parseConfig, formatConfig, ConfigError } from './config.js';
export type { GolemConfig, LocatedApp } from './config.js';
export { gateCounter, BLOCK_LIMIT, DEDUPE_WINDOW_S } from './gate-counter.js';
export { gateExitCode, testExitCode } from './exit.js';
export { encodeStudioHash, decodeStudioHash, studioUrl } from './studio-url.js';
