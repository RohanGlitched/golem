// Temp-directory removal for Node tests. On Windows a worker that was just terminated can still hold a
// handle on a file in the directory for a few milliseconds, so a plain rmSync throws EBUSY or ENOTEMPTY.
import { rmSync } from 'node:fs';

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
