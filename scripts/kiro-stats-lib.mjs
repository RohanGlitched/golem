// Pure counting rules of scripts/kiro-stats.mjs, kept apart so that tests can import them without running the script.

/** `not started` (tasks, none done), `in progress`, `done`, or `no tasks` (a robot's own requirements file has no task list). */
export function tasksStatus(tasks) {
  const done = (tasks.match(/^\s*- \[x\]/gm) || []).length;
  const open = (tasks.match(/^\s*- \[ \]/gm) || []).length;
  if (done + open === 0) return 'no tasks';
  if (done === 0) return 'not started';
  return open === 0 ? 'done' : 'in progress';
}

const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0);

/**
 * Totals over workspaces `{ specs, keys: { agents, hooks, skills, steering } }`.
 * Specs that were not started (open tasks, none done) are listed by the caller but left out of every spec total.
 * An agent, hook, skill or steering file counts once, however many `.kiro` folders hold an identical copy
 * (`golem init` copies the pack into each app); a key is the name plus a hash of the content.
 */
export function computeTotals(workspaces) {
  const all = workspaces.flatMap((w) => w.specs);
  const counted = all.filter((s) => s.status !== 'not started');
  const unique = (kind) => new Set(workspaces.flatMap((w) => w.keys?.[kind] ?? [])).size;
  return {
    specs: counted.length,
    specsNotStarted: all.length - counted.length,
    bugfixSpecs: counted.filter((s) => s.type === 'bugfix').length,
    requirements: sum(counted, (s) => s.requirements),
    earsCriteria: sum(counted, (s) => s.earsCriteria),
    properties: sum(counted, (s) => s.properties),
    tasksDone: sum(counted, (s) => s.tasksDone),
    tasksOpen: sum(counted, (s) => s.tasksOpen),
    steering: unique('steering'),
    hooks: unique('hooks'),
    agents: unique('agents'),
    skills: unique('skills'),
  };
}
