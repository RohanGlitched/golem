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
import { DEFAULT_PUSH_S, arrowLength, findTemplate, resolveArrow, resolveValues } from './ghosts/push-arrow.js';
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
import {
  DEFAULT_TILT_WORDS, boundValues, forceFraction, fractureSignal, fractureWord, fuseFill, harshestScenario, leanDeg, livingSegments,
} from './tablet/living.js';
import { LiveSentence } from './signature/live-sentence.js';
import { SignatureBar } from './signature/signature-bar.js';
import { TrailsView } from './signature/trails-view.js';
import { savePhotograph } from './signature/photograph.js';
import { Sonifier } from './signature/sonifier.js';
import type { AudioContextLike } from './signature/sonifier.js';
import type { Trace } from '../ears/index.js';
import { SwarmClock } from './core/swarm-clock.js';
import { BulletTime } from './core/bullet-time.js';
import { EmetDecal, bodyPoints, highestBody } from './signature/emet-decal.js';
import { emetTarget, foreheadSpot } from './core/emet.js';
import { instantMargins, sampleAt, traceTrial } from './signature/trace-trial.js';
import type { TraceTrialResult } from './signature/trace-trial.js';
import { VerdictPanel } from './verdict/verdict-panel.js';
import type {
  CompiledRequirement, Counterexample, LineModel, RobotApp, Scenario, ShareState, StudioHandle, StudioOptions, StudioState,
  ThemeName, TrialPool, TrialResult, TrialSpec,
} from './types.js';

export const NOT_ELEMENT = 'mountStudio needs an HTMLElement as its first argument';
const STYLE_ID = 'golem-studio-css';
/** The drag preview of a push stays this long after the last change of a quantity. */
export const PREVIEW_MS = 800;
export const LONG_EXPOSURE_LABEL = 'Long exposure';
export const PHOTO_LABEL = 'Save photograph';
export const SOUND_LABEL = 'Sound';
export const NO_AUDIO_TEXT = 'Sound needs Web Audio, which this browser does not offer';

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
/** Turns camera and orbit target together by 
ad about the vertical axis through (px, py). No allocation. */
function orbitAbout(stage: Stage, px: number, py: number, rad: number): void {
  const c = Math.cos(rad), s = Math.sin(rad);
  const rot = (v: { x: number; y: number }): void => {
    const x = v.x - px, y = v.y - py;
    v.x = px + c * x - s * y;
    v.y = py + s * x + c * y;
  };
  rot(stage.camera.position);
  rot(stage.orbit.controls.target);
}

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
  const tiltWords: readonly string[] = [...DEFAULT_TILT_WORDS, ...(options.tiltWords ?? [])];
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
  const clock = new SwarmClock();
  const bullet = new BulletTime();
  const bar = new SignatureBar(doc, {
    onScrub: (tau) => { if (!swarm) return; clock.seek(swarm.playStart + tau); swarm.setFrozen(true); bullet.cancel(); scheduler.requestOnce(); },
    onPlay: () => { clock.play(); swarm?.setFrozen(false); scheduler.requestOnce(); },
    onFreeze: () => { clock.freeze(); swarm?.setFrozen(true); bullet.cancel(); scheduler.requestOnce(); },
  });
  bar.addToggle(LONG_EXPOSURE_LABEL, false, (on) => { trails?.setVisible(on); scheduler.requestOnce(); });
  bar.addButton(PHOTO_LABEL, () => { void photograph(); });
  const sonifier = new Sonifier(() => {
    if (hooks.createAudio) return hooks.createAudio() as AudioContextLike;
    const AC = (win as unknown as { AudioContext?: new () => AudioContextLike; webkitAudioContext?: new () => AudioContextLike } | null);
    const Ctor = AC?.AudioContext ?? AC?.webkitAudioContext;
    return Ctor ? new Ctor() : undefined;
  });
  const soundBtn = bar.addToggle(SOUND_LABEL, false, (on) => {
    sonifier.setEnabled(on);
    if (on && !sonifier.enabled) { soundBtn.setAttribute('aria-pressed', 'false'); store.addMessage('info', NO_AUDIO_TEXT); }
    scheduler.requestOnce();
  });
  main.append(stageHost, bar.el, reelHost);
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
  let following = false;
  let replayPush = { forceN: 0, durS: 0 };

  const tick = (ts: number): void => {
    const dt = lastTs > 0 ? Math.max(0, Math.min(0.25, (ts - lastTs) / 1000)) : 0;
    lastTs = ts;
    const nowMs = now();
    // Bullet time slows the swarm and the hero together.
    const rate = replay.active ? 1 : bullet.rate(nowMs);
    clock.rate = rate;
    clock.advance(dt);
    if (replay.active) {
      replay.advance(dt);
    } else if (hero) {
      hero.advance(dt * rate, nowMs);
    }
    shove?.update();
    swarm?.update(clock.now);
    const turn = bullet.takeDelta(nowMs);
    if (turn !== 0 && stage) orbitAbout(stage, bullet.pivotX, bullet.pivotY, (turn * Math.PI) / 180);
    if (bullet.turning()) scheduler.requestOnce();
    if (swarm) bar.setTimeline(swarm.scrubbable, clock.now - swarm.playStart, swarm.playDuration, clock.frozen);
    updateLive();
    if (emet?.animating) { emet.update(now()); scheduler.requestOnce(); }
    if (sonifier.enabled) { const lm = liveMargin(nowMs); sonifier.setMargin(lm.margin, lm.unit); }
    if (pendingAura !== null && aura) { aura.write(pendingAura); pendingAura = null; }
    if (stage && parts) {
      const groups = parts.bodyGroups;
      const root = groups[1] ?? groups[0];
      const c = swarm && swarm.shown > 0 ? swarm.centroid : null;
      if (c) stage.follow(c[0], c[1]);
      else if (root) stage.follow(root.position.x, root.position.y);
      // The aura is the boundary around the robot being tested: it rides under the ghost swarm while one
      // plays, and under the hero otherwise.
      if (aura) {
        const ax = c ? c[0] : root ? root.position.x : 0, ay = c ? c[1] : root ? root.position.y : 0;
        if (Math.abs(aura.group.position.x - ax) > 1e-3 || Math.abs(aura.group.position.y - ay) > 1e-3) aura.setCentre(ax, ay);
      }
      // The camera follow holds its own render reason while it moves, so "no reason" means no more frames.
      const moving = stage.stepFollow(now(), reduced());
      if (moving !== following) { following = moving; if (moving) scheduler.acquire('following'); else scheduler.release('following'); }
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

  // ---------------------------------------------------------------- long exposure (golem-signature 5)
  let trails: TrailsView | undefined;
  async function photograph(): Promise<void> {
    if (!stage) return;
    const s = store.getState();
    const line = s.lines.find((l) => l.id === s.selectedId);
    const n = trails?.store.count ?? 0;
    const st = stage;
    // A long exposure photographs the trails: the ghosts of the last generation would cover them.
    const hideGhosts = !!(trails?.visible && swarm);
    if (hideGhosts && swarm) swarm.group.visible = false;
    try {
      await savePhotograph({
        renderer: st.renderer, render: () => st.render(), canvas: st.canvas, tokens: TOKENS[s.theme],
        id: line ? `Requirement ${line.id}` : app.name, text: line ? line.text : app.name,
        ...(n > 0 ? { note: `Long exposure of ${n} trials, ${trails?.store.brokenCount() ?? 0} broken` } : {}),
        fileName: `golem-${app.id}-${line ? line.id.replace(/[^A-Za-z0-9._-]/g, '_') : 'stage'}.png`,
      });
      announcer.announceFinal('Saved the photograph');
    } catch (e) {
      announcer.announceError(`The photograph could not be saved: ${errText(e)}`);
    } finally {
      if (hideGhosts && swarm) swarm.group.visible = true;
    }
    scheduler.requestOnce();
  }

  // ---------------------------------------------------------------- sonification (golem-signature 6)
  const projV = new THREE.Vector3();
  const heroSig: Record<string, number> = {};
  const heroOne: Trace = { t: new Float64Array(1), signals: {}, events: [{ name: 'trigger', t: 0 }] };
  let heroMargin = Number.NaN;
  let heroMarginAt = -Infinity;
  let heroSignalsFailed = false;
  /** The selected line's live margin: the replay's trace, the run's closest call, the hero's signals (10 Hz), the verdict. */
  function liveMargin(nowMs: number): { margin: number; unit: string } {
    const s = store.getState();
    const line = s.selectedId ? s.lines.find((l) => l.id === s.selectedId) : undefined;
    if (!line) return { margin: Number.NaN, unit: '' };
    const unit = line.unit ?? (line.compiled ? predicatesOf(line.text, lexicon)[0]?.unit ?? '' : '');
    if (replay.active && replayLine === line.id && line.counterexample) {
      const tr = traced.get(ceKey(line.id, line.counterexample));
      if (tr && tr.inst.length > 0) return { margin: tr.inst[sampleAt(tr.trace.t, app.warmup + replay.t)] as number, unit };
    }
    if (s.run?.lineId === line.id) return { margin: rc.closestCall?.robustness ?? Number.NaN, unit };
    if (hero && heroModel && line.compiled && !replay.active && !hero.sleeping && !heroSignalsFailed) {
      if (nowMs - heroMarginAt >= 100) {
        heroMarginAt = nowMs;
        try {
          app.signals(heroModel.ctx, heroSig);
          const sig = heroOne.signals;
          for (const k in heroSig) { (sig[k] ??= new Float64Array(1))[0] = heroSig[k] as number; }
          heroOne.t[0] = hero.simTime;
          (heroOne.events[0] as { t: number }).t = hero.simTime;
          heroMargin = line.compiled.monitor(heroOne).robustness;
        } catch { heroSignalsFailed = true; heroMargin = Number.NaN; }
      }
      if (heroMargin === heroMargin) return { margin: heroMargin, unit };
    }
    return { margin: line.verdict?.closest.robustness ?? Number.NaN, unit };
  }
  const lastStatus = new Map<string, string>();
  cleanups.push(store.subscribe(() => {
    for (const l of store.getState().lines) {
      const prev = lastStatus.get(l.id);
      if (prev !== l.status) {
        lastStatus.set(l.id, l.status);
        if (prev === 'running' && l.status === 'held') sonifier.chord();
      }
    }
  }));

  // ---------------------------------------------------------------- emet (golem-signature 2)
  let emet: EmetDecal | undefined;
  function setupEmet(bodyId: (n: string) => number): void {
    const opt = options.emet;
    if (opt === false || !parts || !stage) return;
    const body = opt ? bodyId(opt.body) : highestBody(THREE, parts);
    if (!(body >= 0) || !parts.bodyGroups[body]) {
      if (opt) store.addMessage('warning', `The emet decal names body "${opt.body}", which ${app.name} does not have: check StudioOptions.emet.body`);
      return;
    }
    const found = opt?.at ? undefined : foreheadSpot(bodyPoints(THREE, parts, body));
    const spot = opt?.at
      ? { at: opt.at, normal: opt.normal ?? [1, 0, 0] as [number, number, number], width: opt.width ?? 0.06 }
      : found ? { ...found, ...(opt?.normal ? { normal: opt.normal } : {}), ...(opt?.width ? { width: opt.width } : {}) } : undefined;
    if (!spot) return;
    emet = new EmetDecal({
      THREE, tokens: TOKENS[store.getState().theme], spot, hintHost: stage.el, storage, reduced,
      announce: (m) => announcer.announceFinal(m),
    });
    (parts.bodyGroups[body] as THREE.Group).add(emet.group);
    syncEmet();
  }
  function syncEmet(): void {
    if (!emet) return;
    const s = store.getState();
    const status = s.lines.find((l) => l.id === s.selectedId)?.status;
    if (emet.setWord(emetTarget(status, emet.word), now())) scheduler.requestOnce();
    if (stage) stage.el.dataset['golemEmet'] = emet.word;
  }
  cleanups.push(store.subscribe(syncEmet));

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
      onBreak: (_slot, x, y, _z, first) => {
        if (first && !reduced() && !clock.frozen && !replay.active && bullet.trigger(now(), x, y)) scheduler.requestOnce();
        if (sonifier.enabled && stage) { projV.set(x, y, _z).project(stage.camera); sonifier.thud((projV.x + 1) / 2, now()); }
      },
    });
    stage.scene.add(swarm.group);
    trails = new TrailsView(THREE, tokens, store.getState().theme);
    stage.scene.add(trails.lines);
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
      hide: [swarm.group, aura.group, shove.arrow, trails.lines], restoreLive: () => { if (replay.active && replay.poses && parts) applyReplayPose(parts.bodyGroups, replay.poses, replay.t, reduced(), scratch); else hero?.sync(); },
      raf, caf, focusBody: primaryBody,
    });
    stage.onTheme((t) => {
      if (clay) setClayTheme(clay, t);
      swarm?.setTheme(t, store.getState().theme);
      aura?.setTheme(t);
      shove?.setInk(t.ink);
      emet?.setTheme(t);
      trails?.setTheme(t, store.getState().theme);
    });
    setupEmet(bodyId);
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
    onActivity: () => { hero?.wake(); clock.play(); swarm?.setFrozen(false); trails?.clear(); },
    onTrial: (r) => { if (r.poses && trails) trails.add(r.poses.frames, r.poses.nbody, Math.min(primaryBody, r.poses.nbody - 1), r.robustness < 0); },
    onGeneration: () => { if (trails?.visible) { trails.rebuild(); scheduler.requestOnce(); } else trails?.rebuild(); },
    swarmNow: () => clock.now,
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
          const { compiled: _c, fracture: _f, ...rest } = l;
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
      replayPush = line?.compiled && ce ? pushOf(line.compiled, ce.scenario as Scenario) : { forceN: 0, durS: 0 };
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
    tiltWords,
    previewQuantity: (id, text) => previewPush(id, text),
  };

  // ---------------------------------------------------------------- living sentence (golem-signature 1)
  /** Force (N) and window (s) of the first perturbation's push in a scenario, from its `visual` hint. */
  function pushOf(req: CompiledRequirement, scenario: Scenario): { forceN: number; durS: number } {
    const call = req.perturbations[0];
    const tpl = call ? findTemplate(lexicon, call) : undefined;
    if (!call || !tpl || typeof tpl.visual !== 'function') return { forceN: 0, durS: 0 };
    const values = resolveValues(call, scenario);
    try {
      const f = tpl.visual(values)?.force;
      const dur = values['duration'];
      return { forceN: f ? Math.hypot(f[0], f[1], f[2]) : 0, durS: typeof dur === 'number' && dur >= 0 ? dur : DEFAULT_PUSH_S };
    } catch { return { forceN: 0, durS: 0 }; }
  }
  function previewPush(id: string, text: string): void {
    if (!shove || !heroModel) return;
    const req = compileLine(id, text).requirement;
    const call = req?.perturbations[0];
    const tpl = call ? findTemplate(lexicon, call) : undefined;
    if (!req || !call || !tpl || typeof tpl.visual !== 'function') return;
    let v: ReturnType<NonNullable<typeof tpl.visual>> | undefined;
    try { v = tpl.visual(resolveValues(call, harshestScenario(req.space))); } catch { v = undefined; }
    const f = v?.force;
    const lookup = (heroModel.ctx as { lookup?: { body(n: string): number } }).lookup;
    let body = -1;
    try { body = v?.at !== undefined && lookup ? lookup.body(v.at) : -1; } catch { body = -1; }
    if (!f || !(body >= 0)) return;
    shove.preview(body, f[0], f[1], f[2], arrowLength(Math.hypot(f[0], f[1], f[2])));
    if (previewTimer !== undefined) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { previewTimer = undefined; shove?.clearPreview(); }, PREVIEW_MS);
  }
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  cleanups.push(() => { if (previewTimer !== undefined) clearTimeout(previewTimer); });

  const liveSentence = new LiveSentence(root);
  let boundKey = '';
  let bound = { fuseS: Number.NaN, forceN: Number.NaN };
  let lastSelected: string | undefined;
  let heroFuseStart = -1;
  let wasShoving = false;
  const boundOf = (l: LineModel): { fuseS: number; forceN: number } => {
    const k = `${l.id}\n${l.text}`;
    if (k !== boundKey) { boundKey = k; bound = boundValues(livingSegments(l.text, tiltWords)); }
    return bound;
  };
  const leanOf = (g: THREE.Object3D | undefined): number => {
    if (!g || !stage) return 0;
    const e = stage.camera.matrixWorld.elements;
    const q = g.quaternion;
    return leanDeg(q.w, q.x, q.y, q.z, e[0] as number, e[1] as number, e[2] as number);
  };
  /** Per frame: the bound words move only while a trial plays (a replay of this line, or the hero being shoved). */
  function updateLive(): void {
    const s = store.getState();
    if (s.selectedId !== lastSelected) { lastSelected = s.selectedId; liveSentence.invalidate(); }
    const line = s.selectedId ? s.lines.find((l) => l.id === s.selectedId) : undefined;
    if (!line || !parts) { liveSentence.rest(); return; }
    const b = boundOf(line);
    const g = parts.bodyGroups[primaryBody];
    if (replay.active) {
      if (replayLine !== line.id) { liveSentence.rest(); return; }
      const t = replay.t;
      liveSentence.write(leanOf(g), fuseFill(t, b.fuseS), t <= replayPush.durS ? forceFraction(replayPush.forceN, b.forceN) : 0);
      return;
    }
    const shoving = !!shove?.active;
    if (hero && (hero.sleeping || hero.paused)) { heroFuseStart = -1; wasShoving = false; liveSentence.rest(); return; }
    if (shoving && !wasShoving && hero) heroFuseStart = hero.simTime;
    wasShoving = shoving;
    const fuse = heroFuseStart >= 0 && hero ? fuseFill(hero.simTime - heroFuseStart, b.fuseS) : 0;
    if (!shoving && !(heroFuseStart >= 0 && b.fuseS > 0 && fuse < 1)) { heroFuseStart = -1; liveSentence.rest(); return; }
    liveSentence.write(leanOf(g), fuse, forceFraction(shove?.liveForce ?? 0, b.forceN));
  }

  // ---------------------------------------------------------------- fracture (golem-signature 1)
  const traced = new Map<string, TraceTrialResult & { inst: Float64Array }>();
  const traceRequested = new Set<string>();
  let traceChain: Promise<void> = Promise.resolve();
  const requestTrace = (id: string, ce: Counterexample, req: CompiledRequirement): void => {
    const key = ceKey(id, ce);
    if (traceRequested.has(key)) return;
    traceRequested.add(key);
    traceChain = traceChain.then(() => new Promise<void>((resolve) => {
      // After the verdict has drawn: the trial blocks this thread for one trial's CPU time.
      setTimeout(() => {
        if (disposed || !heroModel) { resolve(); return; }
        traceTrial(heroModel.mj, heroModel.model, app, req, ce).then((r) => {
          if (disposed) return;
          traced.set(key, { ...r, inst: instantMargins(req, r.trace) });
          const line = store.getState().lines.find((l) => l.id === id);
          if (!line?.counterexample || ceKey(id, line.counterexample) !== key) return;
          const signal = fractureSignal(r.margins, r.marginsAt);
          const w = fractureWord(livingSegments(line.text, tiltWords), signal, options.signalWords);
          if (!w) return;
          const margin = signal !== undefined ? (r.margins?.[signal] as number) : line.counterexample.robustness;
          store.setLine(id, { fracture: { start: w.start, end: w.end, margin, unit: line.unit ?? r.result.unit, ...(signal !== undefined ? { signal } : {}) } });
        }, () => { /* the fracture falls back to the first response word */ }).finally(resolve);
      }, 30);
    }));
  };
  cleanups.push(store.subscribe(() => {
    for (const l of store.getState().lines) {
      if (l.status === 'broken' && l.counterexample && l.compiled && !l.fracture && heroModel) requestTrace(l.id, l.counterexample, l.compiled);
    }
  }));

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
      emet?.dispose();
      trails?.dispose();
      sonifier.dispose();
      bar.dispose();
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
        swarm.accept(res, { robustness, worstAt: res.worstAt, warmup: app.warmup }, clock.now);
        trails?.add(f, nb, Math.min(primaryBody, nb - 1), falls);
      }
      swarm.commitGeneration(clock.now);
      trails?.rebuild();
      hero.wake();
      scheduler.requestOnce();
    };
    handle.renderCalls = () => (stage?.renderer.info?.render.calls ?? 0);
    (handle as { reasons?: () => string[] }).reasons = () => [...scheduler.active()];
  }
  // Read-only probe of the signature moments for browser tests and screenshots (not part of StudioHandle).
  (handle as { signature?: unknown }).signature = {
    state: () => {
      let head: [number, number] | undefined;
      if (emet && stage) {
        const v = new THREE.Vector3();
        emet.group.getWorldPosition(v).project(stage.camera);
        head = [(v.x * 0.5 + 0.5) * stage.canvas.clientWidth, (-v.y * 0.5 + 0.5) * stage.canvas.clientHeight];
      }
      return {
        emet: emet?.word ?? 'none', crumble: emet?.crumble ?? 0, head, reasons: [...scheduler.active()],
        clock: { now: clock.now, rate: clock.rate, frozen: clock.frozen }, bullet: bullet.active(now()), bulletAngle: bullet.angle(now()),
        timeline: bar.timelineVisible, playStart: swarm?.playStart ?? 0, playDuration: swarm?.playDuration ?? 0,
        trails: { count: trails?.store.count ?? 0, vertices: trails?.vertices ?? 0, visible: trails?.visible ?? false },
        sound: { enabled: sonifier.enabled, state: sonifier.state, hz: sonifier.hz, thuds: sonifier.thuds, chords: sonifier.chords },
      };
    },
    /** Moves the camera to look at the emet decal from `distance` metres in front of it. */
    focusEmet: (distance = 0.7) => {
      if (!emet || !stage) return;
      const p = new THREE.Vector3(), n = new THREE.Vector3(0, 0, 1);
      emet.group.getWorldPosition(p);
      n.applyQuaternion(emet.group.getWorldQuaternion(new THREE.Quaternion()));
      stage.orbit.controls.target.copy(p);
      stage.camera.position.copy(p).addScaledVector(n, distance).add(new THREE.Vector3(0, 0, 0.05));
      stage.orbit.controls.update();
      scheduler.requestOnce();
    },
  };
  return handle;
}
