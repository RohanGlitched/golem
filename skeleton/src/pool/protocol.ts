// Messages between the scheduler (host) and a worker. Everything here is structured-clone safe.
import type { TrialResult, TrialSpec } from '../falsify/contract.js';

export interface WorkerConfig {
  /** URL of a module exporting `createTrialFn(appId, config)`. Default: load MuJoCo and the app. */
  trialModule?: string;
  /** URL of a module exporting `app` (a RobotApp) and `requirements` for the default trial function. */
  appModule?: string;
  /** Base URL for static assets (robot files); the only thing fetched from the network. */
  assetBase?: string;
  [key: string]: unknown;
}

export type HostMessage =
  | { type: 'init'; slot: number; appId: string; config: WorkerConfig }
  | { type: 'run'; id: number; spec: TrialSpec }
  | { type: 'cancel'; id: number }
  | { type: 'probe'; id: number }
  | { type: 'shutdown' };

export type WorkerMessage =
  | { type: 'ready'; slot: number }
  | { type: 'loadError'; slot: number; message: string; stack?: string }
  | { type: 'result'; id: number; result: TrialResult }
  | { type: 'trialError'; id: number; message: string; stack?: string }
  | { type: 'probeReply'; id: number; liveHandles: number }
  | { type: 'log'; level: 'debug' | 'info' | 'warn'; message: string };

/** Buffers to transfer (not copy) with a worker message. */
export function transferList(m: WorkerMessage): ArrayBuffer[] {
  if (m.type === 'result' && m.result.poses !== undefined) {
    return [m.result.poses.frames.buffer as ArrayBuffer];
  }
  return [];
}
