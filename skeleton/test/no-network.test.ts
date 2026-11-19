// Every command and every MCP tool runs on the Tiny_Test_App with fetch, node:net and node:http stubbed to throw.
import { describe, expect, it, vi } from 'vitest';

const boom = (what: string) => () => { throw new Error(`network access attempted: ${what}`); };
vi.mock('node:net', () => ({ connect: boom('net.connect'), createConnection: boom('net.createConnection'), createServer: boom('net.createServer'), Socket: boom('net.Socket'), default: {} }));
vi.mock('node:http', () => ({ request: boom('http.request'), get: boom('http.get'), createServer: boom('http.createServer'), default: {} }));

import { GREEN_REQUIREMENTS, createHarness, stopPayload } from './support/harness.js';
import { createMcpHarness } from './support/mcp-harness.js';
import { installPack } from './support/pack-fixture.js';

describe('no network', () => {
  it('stubs fetch, node:net and node:http so that any attempt fails loudly', async () => {
    vi.stubGlobal('fetch', boom('fetch'));
    const net = await import('node:net');
    expect(() => net.connect(80)).toThrow('network access attempted');
    expect(() => (globalThis.fetch as unknown as () => void)()).toThrow('network access attempted');
  });

  it('runs check, test, falsify, replay, gate, gate --kiro and init', async () => {
    vi.stubGlobal('fetch', boom('fetch'));
    const h = createHarness();
    installPack(h.fs);
    h.io.setStdin(stopPayload('s'));
    const codes = [
      await h.run('check'), await h.run('test', '--budget', '8'), await h.run('falsify', '1.2', '--budget', '12'), await h.run('replay', '1.2'),
      await h.run('gate'), await h.run('gate', '--kiro', '--budget', '8'), await h.run('init'),
    ];
    expect(codes).toEqual([0, 2, 2, 0, 2, 0, 0]);
  });

  it('answers every MCP tool', async () => {
    vi.stubGlobal('fetch', boom('fetch'));
    const m = await createMcpHarness({ predicates: true, requirements: GREEN_REQUIREMENTS.replace('up to 100 N', 'up to 300 N') });
    await m.call('falsify', { reqId: '1.1', budget: 12 });
    const calls: [string, Record<string, unknown>][] = [
      ['list_requirements', {}], ['check_requirement', { text: 'THE robot SHALL keep its tilt below 0.5 rad for 2 s' }], ['run_requirement', { reqId: '1.3', budget: 4 }],
      ['falsify', { reqId: '1.1', budget: 6 }], ['get_counterexample', { reqId: '1.1' }], ['replay', { reqId: '1.1' }], ['explain_margin', { reqId: '1.1' }],
      ['propose_requirement', { text: 'WHEN the base is pushed with up to 90 N THE robot SHALL keep its tilt below 0.3 rad for 1 s' }],
    ];
    for (const [name, args] of calls) expect((await m.call(name, args)).isError, name).toBe(false);
  });
});
