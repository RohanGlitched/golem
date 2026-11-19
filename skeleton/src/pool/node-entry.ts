// The script a Node worker_threads Worker executes: the transport-independent WorkerRunner over parentPort.
import { parentPort } from 'node:worker_threads';
import type { HostMessage } from './protocol.js';
import { defaultTrialLoader } from './trial-loader.js';
import { WorkerRunner } from './worker-runner.js';

const port = parentPort;
if (port === null) throw new Error('node-entry must run inside a worker_threads Worker');
const runner = new WorkerRunner(defaultTrialLoader);
port.on('message', (msg: HostMessage) => {
  void runner.handle(msg, (out, transfer) => port.postMessage(out, transfer ?? []));
});
