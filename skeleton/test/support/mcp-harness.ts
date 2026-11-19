// A Client connected to the golem MCP server through the in-memory transport.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createGolemServer, type GolemServer, type McpAppContext, type ToolDef } from '../../src/mcp/server.js';
import { locateApp } from '../../src/cli/config.js';
import type { CompiledRequirement, PredicateBinding, Trace } from '../../src/cli/sibling-types.js';
import { createHarness, type Harness } from './harness.js';
import type { TestDepsOptions } from './test-deps.js';
import { tinyApp, tinyLexicon } from './tiny-app.js';

export interface McpHarness extends Harness {
  client: Client;
  server: GolemServer;
  logs: string[];
  /** Calls a tool and returns its two text blocks parsed. */
  call(name: string, args?: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<{ isError: boolean; summary: string; json: any; raw: any }>;
  close(): Promise<void>;
}

/** Adds the approved optional `predicates` to every compiled requirement (what a future golem-ears will give). */
export function withPredicates(reqs: CompiledRequirement[]): CompiledRequirement[] {
  const [height, tilt] = tinyLexicon.predicates;
  return reqs.map((r) => ({
    ...r,
    predicates: (r.source.includes('tilt')
      ? [{ predicate: tilt as never, slots: { angle: 0.5 } }]
      : [{ predicate: height as never, slots: { length: r.source.includes('0.3 m') ? 0.3 : 0.4 } }, { predicate: tilt as never, slots: { angle: 0.5 } }]) as PredicateBinding[],
  }));
}

export async function createMcpHarness(o: TestDepsOptions & { requirements?: string; mcpApp?: Partial<McpAppContext>; tools?: ToolDef[]; predicates?: boolean; seed?: boolean; noMargins?: boolean } = {}): Promise<McpHarness> {
  const h = createHarness(o);
  if (o.predicates === true) {
    const base = h.deps.compileFile;
    h.deps.compileFile = ((text, lex, opts) => {
      const r = base(text, lex, opts);
      return { ...r, requirements: withPredicates(r.requirements as CompiledRequirement[]) } as ReturnType<typeof base>;
    }) as typeof base;
  }
  if (o.noMargins === true) {
    // A monitor from before the margin breakdown: ignores the option and returns the three numbers only.
    const base = h.deps.compileFile;
    h.deps.compileFile = ((text, lex, opts) => {
      const r = base(text, lex, opts);
      const requirements = (r.requirements as CompiledRequirement[]).map((q) => ({
        ...q,
        monitor: (trace: Trace) => { const { robustness, worstAt, unit } = q.monitor(trace); return { robustness, worstAt, unit }; },
      }));
      return { ...r, requirements } as ReturnType<typeof base>;
    }) as typeof base;
  }
  let located: McpAppContext['located'];
  try {
    located = await locateApp(h.io.cwd, undefined, h.fs);
  } catch (e) {
    located = { error: (e as Error).message };
  }
  const ctx: McpAppContext = { located, robotApp: tinyApp, toolTimeCapS: 60, ...o.mcpApp };
  const [a, b] = InMemoryTransport.createLinkedPair();
  const logs: string[] = [];
  const server = await createGolemServer({ app: ctx, deps: h.deps, transport: b, log: (l) => logs.push(l), ...(o.tools !== undefined ? { tools: o.tools } : {}) });
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(a);
  return {
    ...h, client, server, logs,
    async call(name, args = {}, opts) {
      const raw: any = await client.callTool({ name, arguments: args }, undefined, opts);
      const [s, j] = raw.content as { text: string }[];
      return { isError: raw.isError === true, summary: (s as { text: string }).text, json: JSON.parse((j as { text: string }).text), raw };
    },
    async close() { await client.close(); await server.close(); },
  };
}
