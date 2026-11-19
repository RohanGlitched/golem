// The script a module Web Worker executes: the transport-independent WorkerRunner over postMessage.
import type { HostMessage, WorkerMessage } from './protocol.js';
import { defaultTrialLoader } from './trial-loader.js';
import { WorkerRunner } from './worker-runner.js';

interface WorkerScope {
  addEventListener(type: 'message', cb: (e: { data: HostMessage }) => void): void;
  postMessage(msg: WorkerMessage, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;
const runner = new WorkerRunner(defaultTrialLoader);
scope.addEventListener('message', (e) => {
  void runner.handle(e.data, (out, transfer) => scope.postMessage(out, transfer ?? []));
});
