// The G1 studio's controller choice (Unitree's policy, or + Kiro's reflex): the page tells every trial worker, and a worker
// applies it with the app's own setReflex, so ghosts run the controller the page shows.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { currentReflex, setReflex } from '../../apps/stagger/app';
import {
  CONTROLLER_CHANNEL, followControllerChoice, hostControllerChoice,
  type ChannelLike, type ControllerKind, type ControllerMessage,
} from '../src/studio/stagger-controller';

/** An in-memory bus: a message posted on one channel reaches every other channel of the bus, as BroadcastChannel does. */
function bus(): () => ChannelLike & { sent: ControllerMessage[] } {
  const all: { deliver(data: unknown): void }[] = [];
  return () => {
    const listeners: ((e: { data: unknown }) => void)[] = [];
    const me = { deliver: (data: unknown) => listeners.forEach((l) => l({ data })) };
    all.push(me);
    const sent: ControllerMessage[] = [];
    return {
      sent,
      postMessage(msg) { sent.push(msg); for (const o of all) if (o !== me) o.deliver(msg); },
      addEventListener(_t, cb) { listeners.push(cb); },
      close() { listeners.length = 0; },
    };
  };
}

describe('hostControllerChoice', () => {
  it('starts on Unitree\u2019s policy and applies that on the page thread', () => {
    const open = bus();
    const applied: ControllerKind[] = [];
    const host = hostControllerChoice(open(), (k) => applied.push(k));
    expect(host.current()).toBe('none');
    expect(applied).toEqual(['none']);
  });

  it('applies a choice on the page thread and sends it, with a rising revision, to the workers', () => {
    const open = bus();
    const applied: ControllerKind[] = [];
    const ch = open();
    const host = hostControllerChoice(ch, (k) => applied.push(k));
    host.choose('kiro');
    host.choose('none');
    expect(applied).toEqual(['none', 'kiro', 'none']);
    expect(ch.sent).toEqual([{ type: 'set', kind: 'kiro', rev: 1 }, { type: 'set', kind: 'none', rev: 2 }]);
  });

  it('answers a worker that starts late with the current choice', () => {
    const open = bus();
    const host = hostControllerChoice(open(), () => {});
    host.choose('kiro');
    const lateApplied: ControllerKind[] = [];
    followControllerChoice(open(), (k) => lateApplied.push(k));
    expect(lateApplied).toEqual(['kiro']);
  });
});

describe('followControllerChoice', () => {
  it('ignores a late, older revision and malformed messages', () => {
    const applied: ControllerKind[] = [];
    let deliver: (data: unknown) => void = () => {};
    followControllerChoice({
      postMessage() {},
      addEventListener(_t, cb) { deliver = (data) => cb({ data }); },
      close() {},
    }, (k) => applied.push(k));
    deliver({ type: 'set', kind: 'kiro', rev: 5 });
    deliver({ type: 'set', kind: 'none', rev: 4 });
    deliver({ type: 'set', kind: 'turbo', rev: 9 });
    deliver({ type: 'set', kind: 'none' });
    deliver('kiro');
    deliver(null);
    expect(applied).toEqual(['kiro']);
  });

  it('property: after any sequence of choices a worker runs the last one, however many workers there are', () => {
    fc.assert(fc.property(
      fc.array(fc.constantFrom<ControllerKind>('none', 'kiro'), { minLength: 1, maxLength: 12 }),
      fc.integer({ min: 1, max: 4 }),
      (choices, workers) => {
        const open = bus();
        const host = hostControllerChoice(open(), () => {});
        const seen: ControllerKind[] = Array.from({ length: workers }, () => 'none');
        seen.forEach((_, i) => followControllerChoice(open(), (k) => { seen[i] = k; }));
        for (const c of choices) host.choose(c);
        expect(seen).toEqual(seen.map(() => choices[choices.length - 1]));
      },
    ));
  });
});

describe('the stagger trial worker script', () => {
  const channels: BroadcastChannel[] = [];
  const RealChannel = globalThis.BroadcastChannel;
  const messageListeners: unknown[] = [];

  beforeAll(async () => {
    // What a Web Worker scope has and Node lacks: `self.location` and `addEventListener` (serveStudioWorker listens for host messages).
    vi.stubGlobal('self', { location: { href: 'http://localhost/stagger/' } });
    vi.stubGlobal('addEventListener', (_t: string, cb: unknown) => { messageListeners.push(cb); });
    vi.stubGlobal('BroadcastChannel', class extends RealChannel {
      constructor(name: string) { super(name); channels.push(this); }
    });
    setReflex('none');
    await import('../src/studio/stagger-worker');
  });

  afterAll(() => {
    for (const c of channels) c.close();
    vi.unstubAllGlobals();
    setReflex('none');
  });

  const until = async (cond: () => boolean): Promise<void> => {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > 3000) throw new Error('the worker did not apply the choice within 3 s');
      await new Promise((r) => setTimeout(r, 5));
    }
  };

  it('listens for the page\u2019s messages and for the choice on the controller channel', () => {
    expect(messageListeners.length).toBe(1);
    expect(channels.length).toBe(1);
  });

  it('switches the app\u2019s reflex to Kiro\u2019s when the page chooses it, and back to Unitree\u2019s when the page chooses that', async () => {
    expect(currentReflex()).toBe('none');
    const page = new RealChannel(CONTROLLER_CHANNEL);
    channels.push(page as BroadcastChannel);
    // the page side applies to a spy, not to setReflex, so a change of the app's reflex can only come from the worker
    const host = hostControllerChoice(page, () => {});
    host.choose('kiro');
    await until(() => currentReflex() === 'kiro');
    host.choose('none');
    await until(() => currentReflex() === 'none');
    host.choose('kiro');
    await until(() => currentReflex() === 'kiro');
    expect(currentReflex()).toBe('kiro');
  });
});
