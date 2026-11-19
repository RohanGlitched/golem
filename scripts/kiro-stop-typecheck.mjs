// Kiro Stop hook for building GOLEM: an agent may not finish while the TypeScript build is red.
// Prints Kiro's {"decision":"block"} JSON with the first errors, so the agent fixes them first.
import { spawnSync } from 'node:child_process';
const r = spawnSync('npx', ['tsc', '-p', 'skeleton/tsconfig.json', '--noEmit'], { encoding: 'utf8', shell: true });
if (r.status === 0) process.exit(0);
const errors = (r.stdout + r.stderr).split('\n').filter((l) => /error TS\d+/.test(l));
const reason = `Typecheck is red (${errors.length} error(s)). Fix them before stopping:\n${errors.slice(0, 12).join('\n')}`;
process.stdout.write(JSON.stringify({ decision: 'block', reason }));
process.exit(0);
