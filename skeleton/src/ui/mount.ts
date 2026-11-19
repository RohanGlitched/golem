// mountStudio: wires stage, hero, shove, swarm, aura, runs, panels, theme and share hash together.
import * as THREE from 'three';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { compileRequirement, extractCriteria } from '../ears/index.js';
import { AuraView } from './aura/aura-view.js';
import { Announcer } from './core/announcer.js';
import { deriveSeed, deriveStream } from './core/prng.js';
import { RenderScheduler } from './core/scheduler.js';
import { StudioStore } from './core/store.js';
import { TOKENS } from './core/theme-tokens.js';
import { syntheticTrialFields } from './core/trial-fields.js';
import { GhostSwarm } from './ghosts/ghost-swarm.js';
import { findTemplate, resolveArrow } from './ghosts/push-arrow.js';
import { HeroSim, DIVERGED_TEXT, SLEEP_TEXT } from './hero/hero-sim.js';
import { loadHero } from './hero/load-hero.js';
import type { HeroModel } from './hero/load-hero.js';
import { ShoveController } from './hero/shove.js';
import { ActionsBar, PanelErrorBoundary } from './layout/boundary.js';
import { studioCss } from './layout/styles.js';
import { ThemeController } from './layout/theme.js';
import { FilmstripRenderer, filmstripFrames, frameLabel } from './reel/filmstrip.js';
import { Reel } from './reel/reel.js';
import { COPY_FAILED_TEXT } from './reel/reel.js';
import { ReplayController, applyReplayPose } from './reel/replay.js';
import { DEFAULT_BUDGET, defaultFalsify } from './run/falsify-adapter.js';
import { canRegister } from './run/inline-pool.js';
import { createStudioPool } from './run/studio-pool.js';
import type { StudioPool } from './run/studio-pool.js';
import { PinnedSeedStore } from './run/pins.js';
import { RunController } from './run/run-controller.js';
import { seedToJson } from './run/seed-json.js';
import { buildShareState, decodeShare, fitShare, ignoredText, tooLongText } from './run/share-hash.js';
import { counterexampleSummary, isFall, predicatesOf, replayLabel, statusOfVerdict } from './run/status.js';
import { buildStage, boundingRadius } from './stage/stage-builder.js';
import type { StageParts } from './stage/stage-builder.js';
import { createClayMaterial, setClayTheme } from './stage/clay-material.js';
import { NO_WEBGL_TEXT, Stage } from './stage/stage.js';
import type { Renderer } from './stage/stage.js';
import type { ReelData, StudioActions } from './tablet/actions.js';
import { Tablet } from './tablet/tablet.js';
import { VerdictPanel } from './verdict/verdict-panel.js';
import type {
  CompiledRequirement, Counterexample, LineModel, RobotApp, Scenario, ShareState, StudioHandle, StudioOptions, StudioState,
  ThemeName, TrialPool, TrialResult, TrialSpec,
} from './types.js';

export const NOT_ELEMENT = 'mountStudio needs an HTMLElement as its first argument';
const STYLE_ID = 'golem-studio-css';

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function isElement(el: unknown): el is HTMLElement {
  if (!el || typeof el !== 'object') return false;
  const win = (el as { ownerDocument?: Document }).ownerDocument?.defaultView as (Window & typeof globalThis) | null | undefined;
  const H = win?.HTMLElement ?? (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement;
  return !!H && el instanceof H;
}

/** Group headings ("### Requirement 2: Push recovery") for each criterion line. */
function headingsByLine(md: string): (line: number) => string | undefined {
  const heads: { line: number; text: string }[] = [];
  md.split(/\r?\n/).forEach((s, i) => { const m = /^###\s+(.+?)\s*$/.exec(s); if (m) heads.push({ line: i + 1, text: m[1] as string }); });
  return (line) => { let h: string | undefined; for (const x of heads) if (x.line < line) h = x.text; return h; };
}

function safeStorage(win: Window | null): Storage | undefined {
  try { const s = win?.localStorage; if (!s) return undefined; const k = '__golem_probe__'; s.setItem(k, '1'); s.removeItem(k); return s; } catch { return undefined; }
}

/** Checks for WebGL without creating a context (the Stage renderer is the studio's only context). */
function probeWebGL(doc: Document): boolean {
  const w = doc.defaultView as (Window & { WebGL2RenderingContext?: unknown; WebGLRenderingContext?: unknown }) | null;
  return !!(w && (w.WebGL2RenderingContext || w.WebGLRenderingContext));
}

export function mountStudio(el: HTMLElement, app: RobotApp, requirementsMarkdown: string, options: StudioOptions = {}): StudioHandle {
  if (!isElement(el)) throw new TypeError(NOT_ELEMENT);
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  const hooks = options.testHooks ?? {};
  const raf = hooks.raf ?? ((cb: (ts: number) => void) => (win as Window).requestAnimationFrame(cb));
  const caf = hooks.caf ?? ((id: number) => (win as Window).cancelAnimationFrame(id));
  const now = hooks.now ?? (() => (win?.performance ?? performance).now());
  const storage = 'storage' in hooks ? hooks.storage : safeStorage(win);
  const matchMedia = hooks.matchMedia ?? (win?.matchMedia ? (q: string) => (win as Window).matchMedia(q) : undefined);
  const seed = options.seed ?? 1;
  const budget = { ...DEFAULT_BUDGET, ...(options.budget ?? {}) };
  const generationSize = Math.max(2, Math.min(64, Math.round(options.ghostGenerationSize ?? 64)));
  const reducedMq = matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = (): boolean => !!reducedMq?.matches;
  const lexicon = app.lexicon;
  let disposed = false;
  const cleanups: (() => void)[] = [];

  // ---------------------------------------------------------------- lines
  const ex = extractCriteria(requirementsMarkdown);
  const headingOf = headingsByLine(requirementsMarkdown);
  const compileLine = (id: string, text: string) => compileRequirement(text, lexicon, { id });
  const toLine = (id: string, text: string, original: string, group: string | undefined): LineModel => {
    const r = compileLine(id, text);
    const hasError = r.diagnostics.some((d) => d.severity === 'error');
    return {
      id, original, text, diagnostics: r.diagnostics, ...(r.requirement ? { compiled: r.requirement } : {}),
      status: hasError ? 'error' : 'untested', stale: false, ...(group ? { group } : {}),
    };
  };
  const originals: Record<string, string> = {};
  for (const c of ex.criteria) originals[c.id] = c.text;
  const known = new Set(Object.keys(originals));
  const messages: StudioState['messages'] = [];
  let share: ShareState = { lines: {} };
  if (win?.location?.hash) {
    const d = decodeShare(win.location.hash, known);
    share = d.state;
    if (d.ignored.length > 0) messages.push({ id: 'share', kind: 'warning', text: ignoredText(d.ignored) });
  }
  const lines = ex.criteria.map((c) => toLine(c.id, share.lines[c.id] ?? c.text, c.text, headingOf(c.line)));
  const fileMessages = ex.diagnostics.map((d) => `Line ${d.line}, column ${d.column}: ${d.kind}: ${d.message}`);
  const sharedSeeds = new Map<string, Counterexample[]>();
  if (share.pick) {
    const p = share.pick;
    sharedSeeds.set(p.reqId, [{ reqId: p.reqId, scenario: p.scenario, seed: p.seed, robustness: Number.NaN, shrunk: false, foundAfter: 0 }]);
    messages.push({ id: 'share-pick', kind: 'info', text: `The shared link names seed ${p.seed} of line ${p.reqId}: summon the ghosts to run it first` });
  }

  // ---------------------------------------------------------------- pool
  let ownedPool: TrialPool | undefined;
  let pool = options.pool;
  let studioPool: StudioPool | undefined;
  if (!pool && options.workerUrl !== undefined) {
    if (hooks.createPool) {
      pool = ownedPool = hooks.createPool(options.workerUrl);
    } else {
      pool = ownedPool = studioPool = createStudioPool(app, {
        workerUrl: options.workerUrl,
        ...(options.workerEntry !== undefined ? { entry: options.workerEntry } : {}),
        ...(options.workerCount !== undefined ? { size: options.workerCount } : {}),
      });
      if (studioPool.notice) messages.push({ id: 'pool', kind: 'info', text: studioPool.notice });
    }
  }

  // ---------------------------------------------------------------- store and DOM
  const store = new StudioStore({
    lines, ...(share.pick ? { selectedId: share.pick.reqId } : {}),
    aura: { total: 0, ignored: 0, summary: 'No trials yet' },
    theme: options.theme ?? 'dark', reducedMotion: reduced(), hero: 'loading', messages, stageFrames: 0, poolConfigured: !!pool,
  }, { raf: (cb) => raf(() => cb()), caf });
  if (reducedMq?.addEventListener) {
    const onRm = (): void => store.update({ reducedMotion: reduced() });
    reducedMq.addEventListener('change', onRm);
    cleanups.push(() => reducedMq.removeEventListener?.('change', onRm));
  }

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = studioCss(options.fontBaseUrl ?? './fonts/') + '.golem-host{display:contents}';
    doc.head.appendChild(style);
  }
  const root = doc.createElement('div');
  root.className = 'golem-studio';
  root.dataset['golemTheme'] = store.getState().theme;
  const host = (cls: string, tag = 'div'): HTMLElement => { const e = doc.createElement(tag); e.className = cls; return e; };
  const actionsHost = host('golem-host');
  const tabletHost = host('golem-host');
  const main = host('golem-main', 'main');
  main.setAttribute('aria-label', `Robot stage for ${app.name}`);
  const stageHost = host('golem-host');
  const reelHost = host('golem-host');
  const verdictHost = host('golem-host');
  const liveHost = host('golem-host');
  main.append(stageHost, reelHost);
  root.append(actionsHost, tabletHost, main, verdictHost, liveHost);
  el.appendChild(root);
  const politeId = `golem-live-${Math.round(now() * 1000) % 1e9}`;
  const alertId = `${politeId}-alert`;
  const polite = doc.createElement('div');
  polite.id = politeId; polite.className = 'golem-sr-only'; polite.setAttribute('aria-live', 'polite'); polite.setAttribute('aria-atomic', 'true');
  const alert = doc.createElement('div');
  alert.id = alertId; alert.className = 'golem-sr-only'; alert.setAttribute('role', 'alert'); alert.setAttribute('aria-atomic', 'true');
  liveHost.append(polite, alert);
  const announcer = new Announcer({ polite, alert });
  const pins = new PinnedSeedStore(storage, (m) => store.addMessage('warning', m), (m) => { store.addMessage('info', m); announcer.announceFinal(m); });

  // ---------------------------------------------------------------- 3D
  let frames = 0;
  let firstFrame = false;
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => { resolveReady = r; });
  let stage: Stage | undefined;
  let hero: HeroSim | undefined;
  let heroModel: HeroModel | undefined;
  let parts: StageParts | undefined;
  let shove: ShoveController | undefined;
  let swarm: GhostSwarm | undefined;
  let aura: AuraView | undefined;
  let film: FilmstripRenderer | undefined;
  let clay: THREE.ShaderMaterial | undefined;
  let lastTs = 0;
  let pendingAura: Parameters<AuraView['write']>[0] | null = null;
  let primaryBody = 1;
  let primaryName = 'body';
  let recentreAura = (): void => {};
  const scratch = new Float64Array(7);

  const replay = new ReplayController({
    hero: { snapshot: () => hero?.snapshot(), restore: () => hero?.restore(), pause: () => hero?.pause(), resume: () => hero?.resume() },
    scheduler: { acquire: (r) => scheduler.acquire(r), release: (r) => scheduler.release(r) },
    reduced,
    onChange: () => {
      store.update({ replay: replay.active ? {
        active: true, playing: replay.playing, t: replay.t, duration: replay.duration, worstTau: replay.worstTau, fps: replay.fps, lineId: replayLine,
      } : undefined, hero: replay.active ? 'replaying' : hero ? (hero.sleeping ? 'sleeping' : 'running') : store.getState().hero });
      if (replay.active && replay.poses && parts) { applyReplayPose(parts.bodyGroups, replay.poses, replay.t, reduced(), scratch); }
      scheduler.requestOnce();
    },
  });
  let replayLine = '';

  const tick = (ts: number): void => {
    const dt = lastTs > 0 ? Math.max(0, Math.min(0.25, (ts - lastTs) / 1000)) : 0;
    lastTs = ts;
    if (replay.active) {
      replay.advance(dt);
    } else if (hero) {
      hero.advance(dt, now());
    }
    shove?.update();
    swarm?.update(now() / 1000);
    if (pendingAura !== null && aura) { aura.write(pendingAura); pendingAura = null; }
    if (stage && parts) {
      const groups = parts.bodyGroups;
      const root = groups[1] ?? groups[0];
      const c = swarm && swarm.shown > 0 ? swarm.centroid : null;
      if (c) stage.follow(c[0], c[1]);
      else if (root) stage.follow(root.position.x, root.position.y);
      if (stage.stepFollow(now(), reduced())) scheduler.requestOnce();
    }
    stage?.orbit.update();
    stage?.render();
    frames++;
    if (!firstFrame && parts) {
      firstFrame = true;
      try { (win?.performance ?? performance).mark?.('golem:first-frame'); } catch { /* old browsers */ }
      el.dataset['firstFrame'] = String(Math.round(now()));
      stage?.showMessage(undefined);
      resolveReady();
    }
    if (scheduler.active().size === 0) lastTs = 0;
  };
  const scheduler = new RenderScheduler({ raf, caf }, tick);

  const webgl = hooks.webgl ?? (hooks.createRenderer ? true : probeWebGL(doc));
  if (!webgl) {
    const m = doc.createElement('div');
    m.className = 'golem-stage golem-stage-none';
    const p = doc.createElement('p'); p.className = 'golem-stage-msg'; p.textContent = NO_WEBGL_TEXT;
    m.appendChild(p);
    stageHost.appendChild(m);
    store.update({ hero: 'no-webgl' });
    resolveReady();
  } else {
    try {
      stage = new Stage(stageHost, {
        THREE, scheduler, tokens: TOKENS[store.getState().theme],
        ...(hooks.createRenderer ? { createRenderer: hooks.createRenderer as (c: HTMLCanvasElement) => Renderer } : {}),
        reduced,
        isOnBody: (e) => shove?.isOnBody(e) ?? false,
        onVisibility: (v) => { if (replay.active) return; if (v) hero?.resume(); else hero?.pause(); lastTs = 0; },
      });
    } catch (e) {
      stageHost.textContent = '';
      const p = doc.createElement('p'); p.className = 'golem-stage-msg'; p.textContent = `${NO_WEBGL_TEXT} (${errText(e)})`;
      stageHost.appendChild(p);
      store.update({ hero: 'no-webgl' });
      resolveReady();
    }
  }

  const failHero = (msg: string): void => {
    store.update({ hero: 'failed' });
    store.addMessage('error', msg, 'hero');
    stage?.showMessage(msg);
    announcer.announceError(msg);
    resolveReady();
  };

  const setupHero = (h: HeroModel): void => {
    heroModel = h;
    if (!stage) return;
    const tokens = TOKENS[store.getState().theme];
    clay = createClayMaterial(THREE, tokens);
    parts = buildStage(h.modelLike, THREE, clay);
    for (const w of parts.warnings) store.addMessage('warning', w);
    const groups = parts.bodyGroups;
    const sync = (xpos: Float64Array, xquat: Float64Array): void => {
      for (let b = 0; b < groups.length; b++) {
        const g = groups[b] as THREE.Group;
        g.position.set(xpos[3 * b] as number, xpos[3 * b + 1] as number, xpos[3 * b + 2] as number);
        g.quaternion.set(xquat[4 * b + 1] as number, xquat[4 * b + 2] as number, xquat[4 * b + 3] as number, xquat[4 * b] as number);
      }
    };
    hero = new HeroSim({
      mj: h.mj, model: h.model, data: h.data, ctx: h.ctx, app, rng: deriveStream(seed, 'hero'),
      stepCap: options.stepCap ?? 40, idleSleepMs: options.idleSleepMs ?? 10000,
      scheduler: { acquire: (r) => scheduler.acquire(r), release: (r) => scheduler.release(r) }, now,
      onDiverged: () => announcer.announceFinal(DIVERGED_TEXT),
      onSleepChange: (s) => { store.update({ hero: s ? 'sleeping' : 'running' }); stage?.showMessage(s ? SLEEP_TEXT : undefined); scheduler.requestOnce(); },
      onSlowChange: (s) => stage?.setSlow(s),
      sync,
    });
    const bound = boundingRadius(THREE, parts);
    stage.setModel(parts, bound);
    // Primary push body: option, else the first perturbation template's visual body.
    const lookup = (h.ctx as { lookup?: { body(n: string): number } }).lookup;
    const bodyId = (n: string): number => { try { return lookup ? lookup.body(n) : -1; } catch { return -1; } };
    const firstVisual = lexicon.perturbations.find((p) => typeof p.visual === 'function');
    let name = options.primaryPushBody;
    if (!name && firstVisual?.visual) { try { name = firstVisual.visual({})?.at; } catch { name = undefined; } }
    if (name && bodyId(name) >= 0) { primaryBody = bodyId(name); primaryName = name; }
    else primaryBody = Math.min(1, Number(h.modelLike.nbody) - 1);
    shove = new ShoveController({
      THREE, canvas: stage.canvas, camera: stage.camera, scene: stage.scene, hero, bodyGroups: parts.bodyGroups, meshes: parts.meshes,
      scheduler, announce: (m) => announcer.announceFinal(m), stiffness: options.shoveStiffness ?? 600, primaryBody,
      simDt: app.simDt, orbitKey: (e) => stage!.orbit.key(e), inkColor: tokens.ink,
    });
    swarm = new GhostSwarm(parts, THREE, {
      nbody: Number(h.modelLike.nbody), tokens, theme: store.getState().theme, riseDepth: Math.max(0.3, bound.height),
      reducedMotion: reduced, warn: (m) => store.addMessage('warning', m), scheduler,
    });
    stage.scene.add(swarm.group);
    aura = new AuraView(THREE, tokens, scheduler);
    const auraCentre = (): void => {
      const v = hero!.views;
      aura!.setCentre(v.xpos[3 * primaryBody] ?? stage!.baseXY[0], v.xpos[3 * primaryBody + 1] ?? stage!.baseXY[1]);
    };
    auraCentre();
    recentreAura = auraCentre;
    stage.scene.add(aura.group);
    film = new FilmstripRenderer({
      THREE, renderer: stage.renderer, scene: stage.scene, mainCamera: stage.camera, bodyGroups: parts.bodyGroups,
      hide: [swarm.group, aura.group, shove.arrow], restoreLive: () => { if (replay.active && replay.poses && parts) applyReplayPose(parts.bodyGroups, replay.poses, replay.t, reduced(), scratch); else hero?.sync(); },
      raf, caf, focusBody: primaryBody,
    });
    stage.onTheme((t) => {
      if (clay) setClayTheme(clay, t);
      swarm?.setTheme(t, store.getState().theme);
      aura?.setTheme(t);
      shove?.setInk(t.ink);
    });
    store.update({ hero: 'running' });
    scheduler.requestOnce();
  };

  if (stage) {
    loadHero(app, hooks.loadHero ? { load: hooks.loadHero as () => Promise<unknown> } : {}).then((h) => {
      if (disposed) { try { h.data.delete(); h.model.delete(); } catch { /* gone */ } return; }
      try { setupHero(h); } catch (e) { failHero(`Could not draw ${app.name}: ${errText(e)}. Reload the page to try again.`); }
    }, (e: unknown) => { if (!disposed) failHero(errText(e)); });
  }

  // ---------------------------------------------------------------- runs
  const reqOf = (id: string): CompiledRequirement | undefined => store.getState().lines.find((l) => l.id === id)?.compiled;
  const fallOf = (req: CompiledRequirement): boolean => isFall(predicatesOf(req.source, lexicon));
  const falsify = hooks.falsify ?? defaultFalsify;
  if (studioPool) {
    studioPool.onFallback = (text) => {
      if (!disposed) store.update((s) => ({ messages: [...s.messages.filter((m) => m.id !== 'pool'), { id: 'pool', kind: 'info', text }] }));
    };
  }
  const rc = new RunController({
    appId: app.id, warmup: app.warmup, store, pool, falsify,
    pins: { read: (a: string, r: string) => [...(sharedSeeds.get(r) ?? []), ...pins.read(a, r)] } as unknown as PinnedSeedStore,
    announcer, now, budget, seed, generationSize,
    swarm: () => swarm,
    auraChanged: (m) => { pendingAura = m; scheduler.requestOnce(); },
    arrowOf: (req, scenario) => {
      const call = req.perturbations[0];
      if (!call || !heroModel) return undefined;
      const lookup = (heroModel.ctx as { lookup?: { body(n: string): number } }).lookup;
      return resolveArrow(call, findTemplate(lexicon, call), scenario, (n) => (lookup ? lookup.body(n) : -1));
    },
    isFall: fallOf,
    ...(options.summaryPhrases ? { summaryPhrases: options.summaryPhrases } : {}),
    onActivity: () => hero?.wake(),
  });
  if (pool && canRegister(pool)) for (const l of lines) if (l.compiled) pool.register(l.compiled);

  // ---------------------------------------------------------------- share hash
  const updateShare = (): void => {
    if (!win?.history?.replaceState) return;
    const s = store.getState();
    const current: Record<string, string> = {};
    for (const l of s.lines) current[l.id] = l.text;
    const sel = s.lines.find((l) => l.id === s.selectedId);
    const pick = sel?.counterexample ? { reqId: sel.id, seed: sel.counterexample.seed, scenario: sel.counterexample.scenario } : undefined;
    const st = buildShareState(originals, current, pick);
    const f = fitShare(st, originals);
    const url = Object.keys(st.lines).length === 0 && !pick ? `${win.location.pathname}${win.location.search}` : f.hash;
    try { win.history.replaceState(win.history.state, '', url); } catch { /* sandboxed */ }
    if (f.tooLong) store.addMessage('warning', tooLongText(f.omittedIds), 'share-long'); else store.removeMessage('share-long');
  };

  // ---------------------------------------------------------------- reel
  const reelCache = new Map<string, ReelData>();
  const ceKey = (id: string, ce: Counterexample): string => `${id}:${ce.seed}:${JSON.stringify(ce.scenario)}`;
  const buildReel = (poses: NonNullable<TrialResult['poses']>, worstAt: number): ReelData => {
    const per = poses.nbody * 7;
    const n = per > 0 ? Math.floor(poses.frames.length / per) : 0;
    const worstTau = Math.max(0, worstAt - app.warmup);
    const entries = filmstripFrames(worstTau, n, poses.fps);
    const labels = entries.map((e) => frameLabel(e.tau, primaryName, poses.frames[(e.frame * poses.nbody + Math.min(primaryBody, poses.nbody - 1)) * 7 + 2] ?? 0));
    return { poses, worstTau, entries, labels };
  };

  const actions: StudioActions = {
    summon: (id) => { void rc.start(id); },
    summonAll: () => { void rc.startAll(); },
    stop: () => { void rc.stop(); },
    select: (id) => { rc.select(id); updateShare(); },
    compile: (id, text) => compileLine(id, text),
    commitLine: (id, text) => {
      const r = compileLine(id, text);
      const hasError = r.diagnostics.some((d) => d.severity === 'error');
      store.update((s) => ({
        lines: s.lines.map((l) => {
          if (l.id !== id) return l;
          const { compiled: _c, ...rest } = l;
          return {
            ...rest, text, diagnostics: r.diagnostics, ...(r.requirement ? { compiled: r.requirement } : {}),
            status: hasError ? 'error' : l.verdict ? statusOfVerdict(l.verdict) : 'untested', stale: !!l.verdict,
          } as LineModel;
        }),
      }));
      if (r.requirement && pool && canRegister(pool)) pool.register(r.requirement);
      updateShare();
      if (!hasError && r.requirement && pool) void rc.start(id);
    },
    reset: () => { if (replay.active) replay.exit(); hero?.reset(); recentreAura(); scheduler.requestOnce(); },
    toggleTheme: () => { theme.toggle(); },
    replay: (id) => {
      const line = store.getState().lines.find((l) => l.id === id);
      const ce = line?.counterexample;
      const data = ce ? reelCache.get(ceKey(id, ce)) : undefined;
      if (!data || !parts) return;
      replayLine = id;
      replay.load(data.poses, data.worstTau);
      replay.enter();
    },
    backToLive: () => { replay.exit(); hero?.sync(); scheduler.requestOnce(); },
    play: () => replay.play(),
    pause: () => replay.pause(),
    seekTime: (t) => replay.seekTime(t),
    stepFrame: (d) => replay.stepFrame(d),
    copySeed: async (ce) => {
      const clip = hooks.clipboard ?? (win?.navigator as Navigator | undefined)?.clipboard;
      try {
        if (!clip) throw new Error('no clipboard');
        await clip.writeText(seedToJson(ce));
        announcer.announceFinal(`Copied seed ${ce.seed} of line ${ce.reqId}`);
        return true;
      } catch {
        announcer.announceFinal(COPY_FAILED_TEXT);
        return false;
      }
    },
    pin: (ce) => {
      const r = pins.pin(app.id, ce);
      announcer.announceFinal(r === 'duplicate' ? `Seed ${ce.seed} of line ${ce.reqId} is already pinned` : `Pinned seed ${ce.seed} of line ${ce.reqId}`);
    },
    removePin: (ce) => { pins.remove(app.id, ce); announcer.announceFinal(`Removed the pin of seed ${ce.seed}`); },
    pinsOf: (id) => pins.read(app.id, id),
    summaryOf: (id, ce) => {
      const req = reqOf(id);
      return req ? counterexampleSummary(req.space, ce.scenario, (ce as { classification?: 'robust' | 'seed-sensitive' }).classification, options.summaryPhrases, fallOf(req)) : '';
    },
    replayLabelOf: (id) => { const req = reqOf(id); return replayLabel(req ? fallOf(req) : false); },
    loadReplay: async (id, signal) => {
      const line = store.getState().lines.find((l) => l.id === id);
      const ce = line?.counterexample;
      const req = line?.compiled;
      if (!ce || !req) throw new Error(`Line ${id} has no counterexample to replay`);
      const key = ceKey(id, ce);
      const hit = reelCache.get(key);
      if (hit) return hit;
      const kept = rc.reelCache.get(id);
      if (kept?.poses && kept.spec.seed === ce.seed) {
        const d = buildReel(kept.poses, kept.worstAt);
        reelCache.set(key, d);
        return d;
      }
      if (!pool) throw new Error('No trial pool is configured, so the failure cannot be replayed');
      if (canRegister(pool)) pool.register(req);
      const [r] = await pool.run([{ app: app.id, reqId: id, scenario: ce.scenario as Scenario, seed: ce.seed, record: 'poses' }], undefined, { signal });
      if (!r?.poses) throw new Error('The replay trial returned no poses');
      const d = buildReel(r.poses, r.worstAt);
      reelCache.set(key, d);
      return d;
    },
    renderFilmstrip: (data, canvases) => (film ? film.start(data.poses.frames, data.poses.nbody, data.entries, canvases) : () => {}),
  };

  // ---------------------------------------------------------------- theme
  const theme = new ThemeController({
    storage, matchMedia, initial: options.theme,
    apply: (t: ThemeName, tokens) => {
      root.dataset['golemTheme'] = t;
      store.update({ theme: t });
      stage?.setTheme(tokens);
    },
  });

  // ---------------------------------------------------------------- React panels
  const roots: Root[] = [];
  const mountPanel = (where: HTMLElement, name: string, node: ReactNode): void => {
    const r = createRoot(where);
    r.render(createElement(PanelErrorBoundary, { name, onError: (e: Error) => announcer.announceError(`The ${name} panel failed: ${e.message}`) }, node));
    roots.push(r);
  };
  mountPanel(actionsHost, 'actions', createElement(ActionsBar, { store, actions }));
  mountPanel(tabletHost, 'tablet', createElement(Tablet, { store, actions, fileMessages }));
  mountPanel(reelHost, 'reel', createElement(Reel, { store, actions }));
  mountPanel(verdictHost, 'verdict', createElement(VerdictPanel, { store, poolSize: pool?.size ?? 0, budget }));

  if (options.autorun && pool) queueMicrotask(() => { if (!disposed) void rc.startAll(); });

  // ---------------------------------------------------------------- handle
  const handle: StudioHandle & { summonSynthetic?(n: number, seconds?: number): void; renderCalls?(): number } = {
    ready,
    getState: () => ({ ...store.getState(), stageFrames: frames }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      rc.abortNow();
      scheduler.setVisible(false);
      for (const c of cleanups.splice(0)) c();
      theme.dispose();
      shove?.dispose();
      swarm?.dispose();
      aura?.dispose();
      film?.dispose();
      clay?.dispose();
      stage?.dispose();
      hero?.dispose();
      if (!hero && heroModel) { try { heroModel.data.delete(); heroModel.model.delete(); } catch { /* gone */ } }
      for (const r of roots.splice(0)) { try { r.unmount(); } catch { /* already gone */ } }
      root.remove();
      if (ownedPool) void ownedPool.close();
      resolveReady();
    },
  };
  if (hooks.summonSynthetic) {
    handle.summonSynthetic = (n: number, seconds = 2): void => {
      if (!swarm || !hero || !heroModel) return;
      const nb = Number(heroModel.modelLike.nbody);
      const fps = 30;
      const nf = Math.floor(seconds * fps) + 2;
      const rng = deriveStream(deriveSeed(seed, 'synthetic'), String(frames));
      const base = new Float64Array(7);
      swarm.beginGeneration();
      for (let i = 0; i < n; i++) {
        const f = new Float32Array(nf * nb * 7);
        const ang = rng() * 2 * Math.PI, sway = 0.05 + rng() * 0.25, falls = rng() < 0.4;
        for (let k = 0; k < nf; k++) {
          const t = k / fps;
          for (let b = 0; b < nb; b++) {
            hero.poseOf(b, base);
            const o = (k * nb + b) * 7;
            const s = sway * Math.sin(Math.min(1, t / Math.max(0.1, seconds)) * Math.PI * 0.5);
            f[o] = (base[0] as number) + s * Math.cos(ang); f[o + 1] = (base[1] as number) + s * Math.sin(ang);
            f[o + 2] = Math.max(0, (base[2] as number) - (falls ? 0.3 * Math.min(1, t / seconds) * (base[2] as number) : 0));
            f[o + 3] = base[3] as number; f[o + 4] = base[4] as number; f[o + 5] = base[5] as number; f[o + 6] = base[6] as number;
          }
        }
        const robustness = falls ? -0.1 : 0.2;
        const spec: TrialSpec = { app: app.id, reqId: 'synthetic', scenario: {}, seed: i, record: 'poses' };
        const poses = { fps, nbody: nb, frames: f };
        const res: TrialResult = {
          spec, robustness, worstAt: app.warmup + seconds * 0.8, unit: 'm', wallMs: 0, poses,
          ...syntheticTrialFields(spec, poses, { warmup: app.warmup, timestep: app.simDt }),
        };
        swarm.accept(res, { robustness, worstAt: res.worstAt, warmup: app.warmup }, now() / 1000);
      }
      swarm.commitGeneration(now() / 1000);
      hero.wake();
      scheduler.requestOnce();
    };
    handle.renderCalls = () => (stage?.renderer.info?.render.calls ?? 0);
    (handle as { reasons?: () => string[] }).reasons = () => [...scheduler.active()];
  }
  return handle;
}
