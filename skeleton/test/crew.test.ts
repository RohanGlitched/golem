import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanUrls } from '../scripts/pack-checks/power.js';
import { readTree } from '../scripts/sync-power.js';
import { PACK_DIR, SKELETON_DIR } from './support/pack.js';

const CREW = join(SKELETON_DIR, 'crew-app');
const app = JSON.parse(readFileSync(join(CREW, 'app.json'), 'utf8')) as Record<string, any>;

describe('Crew app', () => {
  it('has agents, skills, mcpServers and schedule', () => {
    for (const k of ['name', 'version', 'displayName', 'description', 'author', 'iconPath', 'agents', 'skills', 'mcpServers', 'schedule', 'permissions']) expect(app[k], k).toBeDefined();
    expect(app['agents']).toEqual(['agents/golem-tuner.json', 'agents/golem-skeptic.json', 'agents/golem-scribe.json']);
    expect(app['skills']).toEqual(['skills/robot-ears', 'skills/falsify-and-fix']);
    expect(app['mcpServers']).toEqual({ golem: { command: 'npx', args: ['--no-install', 'golem-spec', 'mcp'] } });
  });

  it('fires once per day: five cron fields with a fixed minute and a fixed hour, and an IANA time zone', () => {
    const f = (app['schedule'].cron as string).split(' ');
    expect(f).toHaveLength(5);
    expect(f[0]).toMatch(/^\d+$/);
    expect(f[1]).toMatch(/^\d+$/);
    expect(f.slice(2)).toEqual(['*', '*', '*']);
    expect(Intl.supportedValuesOf('timeZone')).toContain(app['schedule'].timezone);
    expect(app['schedule'].agent).toBe('golem-skeptic');
  });

  it('holds no secret and no network address, and denies network permission', () => {
    expect(app['permissions'].network).toBe(false);
    expect(scanUrls([{ path: 'app.json', text: JSON.stringify(app) }])).toEqual([]);
  });

  it('copies the agents and skills of the pack byte for byte', () => {
    const crew = readTree(CREW);
    for (const role of ['tuner', 'skeptic', 'scribe']) expect(crew.get(`agents/golem-${role}.json`)).toEqual(new Uint8Array(readFileSync(join(PACK_DIR, `agents/golem-${role}.json`))));
    for (const s of ['robot-ears', 'falsify-and-fix']) expect(crew.get(`skills/${s}/SKILL.md`)).toEqual(new Uint8Array(readFileSync(join(PACK_DIR, `skills/${s}/SKILL.md`))));
  });

  it('holds no file beyond app.json and the files it references', () => {
    const referenced = new Set<string>(['app.json', app['iconPath'], ...app['agents']]);
    for (const p of readTree(CREW).keys()) {
      const ok = referenced.has(p) || (app['skills'] as string[]).some((s) => p.startsWith(`${s}/`));
      expect(ok, p).toBe(true);
    }
  });

  it('writes only through propose_requirement and reports the summary and the failure case', () => {
    const p = app['schedule'].prompt as string;
    expect(p).toContain('Submit proposals only with propose_requirement');
    expect(p).toMatch(/never create, modify or delete a requirements file or a file under controller\//);
    expect(p).toContain('the number of proposals written and their requirement ids');
    expect(p).toContain('the ids of the requirements whose latest verdict is broken');
    expect(p).toContain('the number of trials run and the wall time in seconds');
    expect(p).toContain('states the failure and the number of proposals written before it');
  });
});
