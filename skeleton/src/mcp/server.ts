// The MCP server factory (design "MCP server"): low-level `Server`, hand-written schemas, lazy pool, stderr logs only.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ParsedCommand } from '../cli/args.js';
import { ConfigError, locateApp } from '../cli/config.js';
import type { CliIo, KitDeps } from '../cli/deps.js';
import type { TrialPool } from '../cli/sibling-types.js';
import { MissingFileError, compileAll, loadExpectations } from '../cli/service.js';
import { withTimeCap } from './cap.js';
import { FifoQueue, WriteQueue } from './queue.js';
import { makeToolResult, type ToolResult } from './result.js';
import { validateInput, type McpAppContext, type ToolCtx, type ToolDef } from './schema.js';
import { TOOL_NAMES } from './tool-schemas.js';

export type { McpAppContext, ToolCtx, ToolDef };

export interface GolemServerOptions {
  app: McpAppContext;
  deps: KitDeps;
  /** StdioServerTransport in production, an InMemoryTransport in tests. */
  transport: Transport;
  /** stderr only. */
  log?: (line: string) => void;
  /** Replaces the eight default tools (tests). */
  tools?: ToolDef[];
}

export interface GolemServer {
  close(): Promise<void>;
  /** True once a pool exists. */
  poolCreated(): boolean;
}

export async function defaultTools(): Promise<ToolDef[]> {
  const mods = await Promise.all([
    import('./tools/list.js'), import('./tools/check.js'), import('./tools/run.js'), import('./tools/falsify.js'),
    import('./tools/counterexample.js'), import('./tools/replay.js'), import('./tools/explain.js'), import('./tools/propose.js'),
  ]);
  const tools = mods.map((m) => m.tool);
  const order = new Map<string, number>(TOOL_NAMES.map((n, i) => [n, i]));
  return tools.sort((a, b) => (order.get(a.name) ?? 99) - (order.get(b.name) ?? 99));
}

const errorResult = (message: string, extra: Record<string, unknown> = {}): ToolResult => makeToolResult(message, { error: message, ...extra }, true);

/** Rejects with an AbortError as soon as `signal` fires, whatever `p` does. */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); };
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export async function createGolemServer(o: GolemServerOptions): Promise<GolemServer> {
  const log = o.log ?? ((l: string) => { process.stderr.write(`${l}\n`); });
  const tools = o.tools ?? await defaultTools();
  const byName = new Map(tools.map((t) => [t.name, t]));
  const runQueue = new FifoQueue();
  const writeQueue = new WriteQueue();
  let pool: TrialPool | undefined;
  let creating: Promise<TrialPool> | undefined;

  const getPool = async (): Promise<TrialPool> => {
    if (pool !== undefined) return pool;
    if (creating !== undefined) return creating;
    const app = o.app;
    if ('error' in app.located || app.robotApp === undefined) throw new Error('error' in app.located ? app.located.error : 'the app is not loaded');
    const located = app.located;
    creating = o.deps.createPool({ app: app.robotApp, appDir: located.appDir, requirementFiles: located.config.requirements })
      .then((p) => { pool = p; return p; })
      .finally(() => { creating = undefined; });
    return creating;
  };
  const dropPool = async (): Promise<void> => {
    const p = pool;
    pool = undefined;
    try { await p?.close(); } catch (e) { log(`golem mcp: closing the pool failed: ${(e as Error).message}`); }
  };

  const server = new Server({ name: 'golem', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req, extra): Promise<ToolResult> => {
    const name = req.params.name;
    const def = byName.get(name);
    if (def === undefined) return errorResult(`unknown tool "${name}"; tools: ${tools.map((t) => t.name).join(', ')}`);
    if ('error' in o.app.located) return errorResult(o.app.located.error);
    if (o.app.robotApp === undefined) return errorResult('the app could not be loaded');
    const valid = validateInput(def.inputSchema, req.params.arguments);
    if (!valid.ok) return errorResult(`invalid input: ${valid.message}`, { field: valid.field });
    const located = o.app.located;
    const robotApp = o.app.robotApp;
    let usedPool = false;
    try {
      const capped = await withTimeCap(o.app.toolTimeCapS, extra.signal, (signal, capFired) => {
        const ctx: ToolCtx = {
          signal, capFired, deps: o.deps, app: o.app, located, robotApp,
          getPool: async () => { usedPool = true; return getPool(); },
          compile: () => compileAll(located, robotApp, o.deps),
          expectations: () => loadExpectations(located, o.deps),
          runQueue, writeQueue,
        };
        const running = def.handler(valid.value, ctx);
        // A tool that does not watch the signal itself is cut off when the signal fires (requirement 15.5).
        return def.partialOnCap === true ? running : raceAbort(running, signal);
      });
      if (capped.value !== undefined) return capped.value;
      return errorResult(`the time cap of ${o.app.toolTimeCapS} s ended the call before it finished; nothing was written`);
    } catch (e) {
      const msg = e instanceof MissingFileError || e instanceof ConfigError ? e.message : (e as Error).message;
      if ((e as { name?: string }).name === 'AbortError') return errorResult('the call was cancelled; nothing was written');
      if (usedPool) await dropPool();
      log(`golem mcp: ${name} failed: ${msg}`);
      return errorResult(`${name} failed: ${msg}`);
    }
  });

  await server.connect(o.transport);
  return {
    poolCreated: () => pool !== undefined,
    async close() {
      await dropPool();
      await server.close();
    },
  };
}

/** Starts the stdio server for `golem mcp`. Returns 0 when stdin closes (the pool is closed first). */
export async function runStdioServer(p: ParsedCommand, io: CliIo, deps: KitDeps, opts: { transport?: Transport } = {}): Promise<number> {
  const log = (l: string): void => { io.stderr.write(`${l}\n`); };
  const appFlag = typeof p.flags['app'] === 'string' ? p.flags['app'] : undefined;
  let ctx: McpAppContext;
  try {
    const located = await locateApp(io.cwd, appFlag, deps.fs);
    try {
      ctx = { located, robotApp: await deps.loadApp(located.config.app), toolTimeCapS: located.config.toolTimeCapS ?? 60 };
    } catch (e) {
      ctx = { located: { error: `cannot load the app ${located.config.app}: ${(e as Error).message}` }, toolTimeCapS: located.config.toolTimeCapS ?? 60 };
    }
  } catch (e) {
    if (e instanceof ConfigError && e.field === 'toolTimeCapS') {
      log(`golem: ${e.message}`);
      return 1;
    }
    ctx = { located: { error: (e as Error).message }, toolTimeCapS: 60 };
  }
  const transport = opts.transport ?? new StdioServerTransport();
  const closed = new Promise<void>((resolve) => {
    const prev = transport.onclose;
    transport.onclose = () => { prev?.(); resolve(); };
    // The stdio transport does not notice the end of stdin by itself (requirement 10.4).
    if (opts.transport === undefined) {
      process.stdin.once('end', () => resolve());
      process.stdin.once('close', () => resolve());
    }
  });
  const server = await createGolemServer({ app: ctx, deps, transport, log });
  await closed;
  await server.close().catch(() => undefined);
  return 0;
}
