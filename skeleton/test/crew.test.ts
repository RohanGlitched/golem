import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { scanUrls } from '../scripts/pack-checks/power.js';
import { readTree } from '../scripts/sync-power.js';
import { PACK_DIR, SKELETON_DIR } from './support/pack.js';

const CREW = join(SKELETON_DIR, 'crew-app');
const app = JSON.parse(readFileSync(join(CREW, 'app.json'), 'utf8')) as Record<string, any>;
const readme = readFileSync(join(CREW, 'README.md'), 'utf8');

// Top-level fields and nested keys defined by https://kiro.dev/docs/crew/apps/manifest/ (read 2026-11).
const MANIFEST_FIELDS = new Set([
  'name', 'version', 'displayName', 'description', // required
  'author', 'license', 'minKiroCrewVersion', 'tags', 'jobFamilies', // metadata
  'agents', 'skills', 'sops', 'mcpServers', // resources
  'repo', 'iconPath', 'screenshots', 'highlights', 'heroImage', 'heroImageDark', 'heroImageDetail', 'heroImageDetailDark', // store listing
  'crons', 'ui', 'backend', 'permissions', 'contributes', 'setup', 'dependencies', 'lifecycle', 'resources', 'platform', 'openCommand',
]);
const CRON_KEYS = new Set(['name', 'every', 'cron_expr', 'message', 'agent', 'enabled']);
const PERMISSION_KEYS = new Set(['api', 'events', 'mcpTools', 'storage', 'cron', 'memory', 'network', 'jobs']);
const MCP_SERVER_KEYS = new Set(['command', 'args', 'url', 'env']);

const pngInfo = (b: Buffer): { w: number; h: number; colorType: number; alphaAt: (x: number, y: number) => number } => {
  expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  const depth = b[24] as number, colorType = b[25] as number, interlace = b[28] as number;
  expect([depth, interlace]).toEqual([8, 0]);
  const idat: Buffer[] = [];
  for (let o = 8; o < b.length;) {
    const len = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8);
    if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 4 ? 2 : colorType === 2 ? 3 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)] as number;
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i] as number;
      const a = i >= bpp ? (px[y * stride + i - bpp] as number) : 0;
      const up = y > 0 ? (px[(y - 1) * stride + i] as number) : 0;
      const c = i >= bpp && y > 0 ? (px[(y - 1) * stride + i - bpp] as number) : 0;
      const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      px[y * stride + i] = (x + [0, a, up, (a + up) >> 1, paeth][f]!) & 255;
    }
  }
  return { w, h, colorType, alphaAt: (x, y) => (colorType === 6 || colorType === 4 ? (px[y * stride + x * bpp + bpp - 1] as number) : 255) };
};

const jpegSize = (b: Buffer): { w: number; h: number } => {
  expect(b.subarray(0, 2).toString('hex')).toBe('ffd8');
  for (let o = 2; o < b.length;) {
    expect(b[o]).toBe(0xff);
    const m = b[o + 1] as number, len = b.readUInt16BE(o + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(o + 5), w: b.readUInt16BE(o + 7) };
    o += 2 + len;
  }
  throw new Error('no SOF marker');
};

describe('Crew app manifest against the documented reference', () => {
  it('uses only fields the Manifest reference defines', () => {
    expect(Object.keys(app).filter((k) => !MANIFEST_FIELDS.has(k))).toEqual([]);
    expect(app['schedule']).toBeUndefined();
  });

  it('has the four required fields as non-empty strings, a kebab-case name and a semver version', () => {
    for (const k of ['name', 'version', 'displayName', 'description']) expect(typeof app[k] === 'string' && app[k].length > 0, k).toBe(true);
    expect(app['name']).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(app['version']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(app['author']).toBeTruthy();
  });

  it('types the optional fields as documented', () => {
    for (const k of ['author', 'license', 'repo', 'iconPath']) expect(typeof app[k], k).toBe('string');
    for (const k of ['tags', 'agents', 'skills', 'screenshots', 'highlights']) expect(Array.isArray(app[k]) && app[k].every((x: unknown) => typeof x === 'string'), k).toBe(true);
    expect(app['screenshots'].length).toBeLessThanOrEqual(5);
    expect(app['highlights'].length).toBeLessThanOrEqual(10);
  });

  it('keeps every path relative, inside the app root and existing', () => {
    const paths: string[] = [app['iconPath'], ...app['screenshots'], ...app['agents'], ...app['skills']];
    for (const p of paths) {
      expect(isAbsolute(p), p).toBe(false);
      expect(normalize(p).split(/[\\/]/), p).not.toContain('..');
      expect(existsSync(join(CREW, p)), p).toBe(true);
    }
  });

  it('declares the nightly job in crons with a cron_expr, a message and a defined agent, and no schedule block', () => {
    expect(app['crons']).toHaveLength(1);
    const c = app['crons'][0] as Record<string, unknown>;
    expect(Object.keys(c).filter((k) => !CRON_KEYS.has(k))).toEqual([]);
    expect(typeof c['name']).toBe('string');
    expect(typeof c['message']).toBe('string');
    expect(c['every'] === undefined && typeof c['cron_expr'] === 'string', 'exactly one of every / cron_expr').toBe(true);
    expect(c['enabled'] === undefined || typeof c['enabled'] === 'boolean').toBe(true);
    const agentNames = (app['agents'] as string[]).map((a) => JSON.parse(readFileSync(join(CREW, a), 'utf8')).name);
    expect(agentNames).toContain(c['agent']);
    expect(c['agent']).toBe('golem-skeptic');
  });

  it('fires once per day: five cron_expr fields with a fixed minute and a fixed hour', () => {
    const f = (app['crons'][0].cron_expr as string).split(' ');
    expect(f).toHaveLength(5);
    expect(f[0]).toMatch(/^\d+$/);
    expect(f[1]).toMatch(/^\d+$/);
    expect(f.slice(2)).toEqual(['*', '*', '*']);
  });

  it('declares only documented permission keys, asks for no cron permission and denies network', () => {
    expect(Object.keys(app['permissions']).filter((k) => !PERMISSION_KEYS.has(k))).toEqual([]);
    expect(app['permissions']).toEqual({ network: false });
  });

  it('defines mcpServers with command, args, url or env only', () => {
    expect(app['mcpServers']).toEqual({ golem: { command: 'npx', args: ['--no-install', 'golem-spec', 'mcp'] } });
    for (const s of Object.values(app['mcpServers']) as Record<string, unknown>[]) expect(Object.keys(s).filter((k) => !MCP_SERVER_KEYS.has(k))).toEqual([]);
  });
});

describe('Crew app store assets', () => {
  it('has an icon that is a square PNG of at least 256 px with transparent corners', () => {
    const i = pngInfo(readFileSync(join(CREW, app['iconPath'])));
    expect(i.w).toBe(i.h);
    expect(i.w).toBeGreaterThanOrEqual(256);
    expect([4, 6]).toContain(i.colorType);
    for (const [x, y] of [[0, 0], [i.w - 1, 0], [0, i.h - 1], [i.w - 1, i.h - 1]] as const) expect(i.alphaAt(x, y), `corner ${x},${y}`).toBe(0);
    expect(i.alphaAt(i.w >> 1, i.h >> 1)).toBe(255);
  });

  it('has one screenshot, 1200 px wide at 16:9', () => {
    expect(app['screenshots']).toHaveLength(1);
    const p = join(CREW, app['screenshots'][0]);
    expect(app['screenshots'][0]).toMatch(/\.(png|jpe?g)$/);
    const b = readFileSync(p);
    const s = app['screenshots'][0].endsWith('.png') ? (() => { const i = pngInfo(b); return { w: i.w, h: i.h }; })() : jpegSize(b);
    expect(s.w).toBe(1200);
    expect(s.h).toBe(675);
  });

  it('has a README that records the doc page of every manifest field and of every dropped field', () => {
    expect(readme.length).toBeGreaterThan(500);
    for (const url of ['https://kiro.dev/docs/crew/apps/manifest/', 'https://kiro.dev/docs/crew/apps/build-first-app/', 'https://kiro.dev/docs/crew/apps/publishing/']) expect(readme).toContain(url);
    const keptSection = readme.slice(readme.indexOf('### Fields kept'), readme.indexOf('### Fields dropped'));
    for (const k of Object.keys(app)) expect(keptSection, k).toContain(`\`${k}`);
    for (const row of keptSection.split('\n').filter((l) => l.startsWith('| `'))) expect(row, row).toMatch(/Manifest reference|Build your first app|Publishing/);
    const dropped = readme.slice(readme.indexOf('### Fields dropped'));
    for (const k of ['schedule', 'schedule.timezone', 'permissions.cron']) expect(dropped, k).toContain(`\`${k}\``);
  });

  it('explains that the summary is output text and not a network request', () => {
    expect(readme).toMatch(/summary is text in the run's output/);
    expect(app['permissions'].network).toBe(false);
    expect(app['description']).not.toMatch(/\bpost/i);
    expect(app['crons'][0].message).not.toMatch(/\bpost\b/i);
    expect(app['crons'][0].message).toContain("final reply");
  });
});

describe('Crew app', () => {
  it('has agents, skills and mcpServers', () => {
    expect(app['agents']).toEqual(['agents/golem-tuner.json', 'agents/golem-skeptic.json', 'agents/golem-scribe.json']);
    expect(app['skills']).toEqual(['skills/robot-ears', 'skills/falsify-and-fix']);
  });

  it('holds no secret and no network address in app.json', () => {
    expect(scanUrls([{ path: 'app.json', text: JSON.stringify(app) }])).toEqual([]);
  });

  it('copies the agents and skills of the pack byte for byte', () => {
    const crew = readTree(CREW);
    for (const role of ['tuner', 'skeptic', 'scribe']) expect(crew.get(`agents/golem-${role}.json`)).toEqual(new Uint8Array(readFileSync(join(PACK_DIR, `agents/golem-${role}.json`))));
    for (const s of ['robot-ears', 'falsify-and-fix']) expect(crew.get(`skills/${s}/SKILL.md`)).toEqual(new Uint8Array(readFileSync(join(PACK_DIR, `skills/${s}/SKILL.md`))));
  });

  it('holds no file beyond app.json, README.md and the files it references', () => {
    const referenced = new Set<string>(['app.json', 'README.md', app['iconPath'], ...app['screenshots'], ...app['agents']]);
    for (const p of readTree(CREW).keys()) {
      const ok = referenced.has(p) || (app['skills'] as string[]).some((s) => p.startsWith(`${s}/`));
      expect(ok, p).toBe(true);
    }
  });

  it('writes only through propose_requirement and reports the summary and the failure case', () => {
    const p = app['crons'][0].message as string;
    expect(p).toContain('Submit proposals only with propose_requirement');
    expect(p).toMatch(/never create, modify or delete a requirements file or a file under controller\//);
    expect(p).toContain('the number of proposals written and their requirement ids');
    expect(p).toContain('the ids of the requirements whose latest verdict is broken');
    expect(p).toContain('the number of trials run and the wall time in seconds');
    expect(p).toContain('states the failure and the number of proposals written before it');
  });
});
