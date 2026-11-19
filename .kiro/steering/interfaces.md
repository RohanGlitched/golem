---
inclusion: always
---
# Cross-module contracts (do not change without updating every spec)

These TypeScript shapes are the seams between `ears`, `sim`, `falsify`, `pool`, `ui`, `cli` and the apps. Specs may add fields but never rename or remove these.

```ts
// ---------- units & quantities (ears) ----------
type Kind = 'force' | 'duration' | 'length' | 'speed' | 'angle' | 'mass' | 'ratio' | 'count' | 'phase';
interface Quantity { kind: Kind; si: number; text: string }            // text = as written, e.g. "200 N"

// ---------- scenario space (ears → falsify) ----------
interface Dimension {
  name: string;               // e.g. "push.force"
  kind: Kind;
  min: number; max: number;   // SI; min === max means fixed
  severity: 'up' | 'down' | 'none';   // which way is harsher (force: 'up')
  wrap?: boolean;             // angles and phases wrap around
}
interface ScenarioSpace { dims: Dimension[] }
type Scenario = Record<string, number>;   // dim name → SI value

// ---------- traces (sim → ears monitors) ----------
interface Trace {
  t: Float64Array;                          // seconds, control-rate samples
  signals: Record<string, Float64Array>;    // same length as t
  events: { name: string; t: number }[];    // e.g. {name:'trigger', t:2.0}
}

// ---------- compiled requirement (ears) ----------
interface CompiledRequirement {
  id: string;                 // "R2" or "2.1"
  source: string;             // the EARS line as written
  pattern: 'ubiquitous' | 'event' | 'state' | 'unwanted' | 'optional';
  space: ScenarioSpace;       // what the falsifier may vary
  perturbations: PerturbationCall[];   // what to inject, parameterised by space dims
  horizon: number;            // seconds of sim needed after warm-up
  monitor(trace: Trace): { robustness: number; worstAt: number; unit: string };
}
interface PerturbationCall { template: string; params: Record<string, string | number> } // string = dim name

// ---------- the app contract (every app implements this) ----------
interface RobotApp {
  id: string; name: string;
  files(): Promise<Record<string, Uint8Array>>;   // path under /robot → bytes (scene.xml, meshes…)
  sceneFile: string;                              // e.g. "scene.xml"
  simDt: number; controlDt: number; warmup: number;
  lexicon: Lexicon;
  makeController(ctx: SimContext, rng: () => number): Controller;
  signals(ctx: SimContext, out: Record<string, number>): void;   // write current signal values
  initState?(ctx: SimContext, rng: () => number): void;          // randomise initial state
  endTrial?(ctx: SimContext): void;   // restore any model fields a perturbation changed (gravity, mass, friction); sim calls it in `finally`
}
interface Controller { step(ctx: SimContext, t: number): void }  // writes ctx.data.ctrl
interface SimContext { mj: any; model: any; data: any; ids: Record<string, number> }

interface Lexicon {
  robotNames: string[];                       // words allowed after THE, e.g. ["robot","golem","G1"]
  predicates: PredicateTemplate[];
  perturbations: PerturbationTemplate[];
}
interface PredicateTemplate {
  phrase: string;                             // "keep its pelvis above {length}"
  signals: string[];                          // signals it reads
  margin(s: Record<string, number>, slots: Record<string, number>): number; // >0 holds, physical unit
  unit: string;
  slots?: Record<string, SlotDimension>;      // optional: Dimensions this predicate adds (same rules as below)
}
interface PerturbationTemplate {
  phrase: string;                             // "the pelvis is pushed with {range:force} for {duration} from {direction}"
  slots?: Record<string, SlotDimension>;      // slot name → Dimension name + severity; the compiler builds the Dimension
  /** @deprecated declare `slots`; called only when `slots` is absent */
  dims?(slots: Record<string, Quantity | [Quantity, Quantity] | string>, ranges: Record<string, SlotRange>): Dimension[];
  apply(ctx: SimContext, t: number, tTrigger: number, values: Record<string, number>): void;  // values keyed by slot name
}
interface SlotDimension { dim: string; severity: 'up' | 'down' | 'none' }   // e.g. direction → { dim: 'push.angle', severity: 'none' }
interface SlotRange { kind: Kind; min: number; max: number; wrap: boolean }  // a slot's parsed range in SI (min === max when fixed)

// ---------- trials and verdicts (sim / falsify / pool) ----------
interface TrialSpec { app: string; reqId: string; scenario: Scenario; seed: number; record?: 'none' | 'poses' }
interface TrialResult {
  spec: TrialSpec; robustness: number; worstAt: number; unit: string;
  wallMs: number;
  poses?: { fps: number; nbody: number; frames: Float32Array };   // per frame: nbody × (x,y,z,qw,qx,qy,qz)
}
interface Counterexample { reqId: string; scenario: Scenario; seed: number; robustness: number; shrunk: boolean; foundAfter: number }
interface Verdict {
  reqId: string; status: 'held' | 'broken' | 'error';
  trials: number; randomTrials: number; guidedTrials: number;
  closest: { robustness: number; scenario: Scenario; seed: number };  // lowest margin seen
  counterexample?: Counterexample;
  failureRateUpper95?: number;    // from the random phase only (rule of three when 0 failures)
  ms: number;
}
interface TrialPool { run(specs: TrialSpec[], onResult?: (r: TrialResult) => void): Promise<TrialResult[]>; size: number; close(): Promise<void> }
```

## Approved additions
- `RobotApp.endTrial?` (above). Perturbations that change `model` fields must be undone there, because the model is shared across trials in a worker.
- `PerturbationTemplate.visual?(values) => { force?: [number,number,number]; at?: string }`: an optional hint the UI uses to draw push arrows.
- `TrialPool.run(specs, onResult?, opts?: { signal?: AbortSignal })`.
- `Lexicon.episodeSeconds?` (default 10 s) and `PredicateTemplate.dims?` (golem-ears).
- **Changed by golem-ears-hardening (defects 1 and 10):** `PerturbationTemplate.dims` is now optional and deprecated. A template declares `slots` (slot name → `SlotDimension`) and the ears compiler builds each `Dimension` from the range written in the line: kind, min, max and wrap in SI from the parse, name and severity from the declaration. `PerturbationCall.params` has one entry per slot, keyed by slot name: the Dimension name when the slot is searched, its SI value when fixed. A searched slot with no declaration is a `BAD_LEXICON` compile error. The deprecated `dims(slots, ranges)` still works: the compiler ties each returned Dimension to a slot (exact name, `.<slot>` suffix, equal kind and bounds, or the only one of its kind) and warns about any it cannot tie. `PredicateTemplate.slots?` follows the same rules. Slot names are the kind (`force`, `duration`, `direction`, `phase`), with a suffix from 2 for a repeated kind (`length2`).
- `Lexicon.features?: string[]` (golem-ears-hardening defect 6): the feature names a WHERE clause may name. A WHERE line that names any other feature is an `UNKNOWN_PHRASE` compile error with the closest declared feature as its suggestion.
- `PerturbationTemplate.maxOnset?: number` (golem-ears-hardening defect 11): the latest start of the effect, in seconds after `tTrigger` (for example one gait period when a push waits for a stride phase). The compiler adds it to `for` windows, `within` deadlines and horizons.
- Apps may keep per-trial runtime state in a `WeakMap<SimContext, …>`.
- Pinned sources: unitree_rl_gym `276801e46c5d433564f24658bac64f254b7d2d4b`; mujoco_menagerie `370c43965323c0944b433b202aac5058b5f907a9`.

## Files on disk
- `.golem/seeds/<app>/<reqId>.json`: pinned counterexamples (`Counterexample[]`). They always re-run first.
- `.golem/report.json`: the last full run (`Verdict[]` + metadata: budget, commit, duration).
- `golem gate` exits **0** only when every requirement is `held` and no pinned seed fails. Otherwise it exits **2** and prints one line per broken requirement, with its reproduction command.
