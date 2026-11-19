// CliIo over the Node process streams.
import type { CliIo } from './deps.js';

export function createNodeIo(): CliIo {
  return {
    stdout: { write: (s) => { process.stdout.write(s); } },
    stderr: { write: (s) => { process.stderr.write(s); } },
    stdin: {
      isTTY: process.stdin.isTTY === true,
      /** Reads stdin to its end, or gives up after `timeoutMs` and returns what arrived (or undefined). */
      read(timeoutMs) {
        return new Promise<string | undefined>((resolve) => {
          const chunks: Buffer[] = [];
          let done = false;
          const finish = (): void => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            process.stdin.off('data', onData);
            process.stdin.off('end', finish);
            process.stdin.off('error', finish);
            process.stdin.pause();
            resolve(chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : undefined);
          };
          const onData = (c: Buffer): void => { chunks.push(c); };
          const timer = setTimeout(finish, timeoutMs);
          process.stdin.on('data', onData);
          process.stdin.on('end', finish);
          process.stdin.on('error', finish);
        });
      },
    },
    cwd: process.cwd().replace(/\\/g, '/'),
  };
}
