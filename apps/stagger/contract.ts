// Contract shapes from .kiro/steering/interfaces.md. golem-spec does not export these types yet
// (golem-ears is unmerged), so the app repeats them; structural typing keeps them compatible.
export type Kind = 'force' | 'duration' | 'length' | 'speed' | 'angle' | 'mass' | 'ratio' | 'count' | 'phase';
export interface Quantity { kind: Kind; si: number; text: string }
export interface Dimension {
  name: string; kind: Kind; min: number; max: number;
  severity: 'up' | 'down' | 'none'; wrap?: boolean;
}
export type Scenario = Record<string, number>;
export interface SimContext { mj: any; model: any; data: any; ids: Record<string, number> }
export interface Controller { step(ctx: SimContext, t: number): void }
export type Slots = Record<string, Quantity | [Quantity, Quantity] | string>;
export interface PredicateTemplate {
  phrase: string;
  signals: string[];
  margin(s: Record<string, number>, slots: Record<string, number>): number;
  unit: string;
  dims?(slots: Slots): Dimension[];
}
export interface PerturbationTemplate {
  phrase: string;
  name?: string;
  dims(slots: Slots): Dimension[];
  apply(ctx: SimContext, t: number, tTrigger: number, values: Record<string, number>): void;
  visual?(values: Record<string, number>): { force?: [number, number, number]; at?: string };
}
export interface Lexicon {
  robotNames: string[];
  predicates: PredicateTemplate[];
  perturbations: PerturbationTemplate[];
  episodeSeconds?: number;
}
export interface RobotApp {
  id: string; name: string;
  files(): Promise<Record<string, Uint8Array>>;
  sceneFile: string;
  simDt: number; controlDt: number; warmup: number;
  lexicon: Lexicon;
  makeController(ctx: SimContext, rng: () => number): Controller;
  signals(ctx: SimContext, out: Record<string, number>): void;
  initState?(ctx: SimContext, rng: () => number): void;
  endTrial?(ctx: SimContext): void;
  names?: Partial<Record<'body' | 'geom' | 'site' | 'joint' | 'actuator', string[]>>;
}