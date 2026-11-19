// Probe 2: `golem gate` and `golem gate --kiro` end to end over the Tiny test app (1.1 holds, 1.2 breaks at 200 N, 1.3 holds).
// Run from skeleton/: npx tsx ../docs/reviews/gate-audit-probes/p2-gate.mts [filter]
import { GREEN_REQUIREMENTS, RED_REQUIREMENTS, createHarness, stopPayload } from '../../../skeleton/test/support/harness.js';

const table = (rows: string[], head = '| Criterion | Topic | Expectation |\n|---|---|---|'): string => `\n${head}\n${rows.join('\n')}\n`;
const before = (text: string, rows: string[], head?: string): string => text.replace('### Requirement 1', `${table(rows, head)}\n### Requirement 1`);
const after = (text: string, rows: string[]): string => `${text}\n## Notes\n${table(rows)}`;
const filter = process.argv[2];

async function gate(name: string, requirements: string, ...flags: string[]): Promise<void> {
  if (filter !== undefined && !name.includes(filter)) return;
  const h = createHarness({ requirements });
  const code = await h.run('gate', ...flags);
  console.log(`\n=== ${name}  [gate ${flags.join(' ')}]  exit ${code}`);
  console.log('--- stdout\n' + h.io.stdoutText().trimEnd());
  const err = h.io.stderrText().trimEnd();
  if (err !== '') console.log('--- stderr\n' + err);
}

async function kiro(name: string, requirements: string): Promise<void> {
  if (filter !== undefined && !name.includes(filter)) return;
  const h = createHarness({ requirements });
  h.clock.advance(3000);
  h.io.setStdin(stopPayload('s1'));
  const code = await h.run('gate', '--kiro', '--budget', '12');
  console.log(`\n=== ${name}  [gate --kiro]  exit ${code}`);
  const out = h.io.stdoutText();
  if (out === '') console.log('--- stdout: (empty: stop allowed)');
  else { const j = JSON.parse(out); console.log(`--- stdout decision=${j.decision} reason(${j.reason.length} chars):\n${j.reason}`); }
  const err = h.io.stderrText().trimEnd();
  if (err !== '') console.log('--- stderr (not visible to the agent on exit 0)\n' + err);
}

const B = 'Expected_Break';
const H = 'Expected_Hold';

// ---- A. the cases the brief lists
await gate('A1 no table at all', RED_REQUIREMENTS);
await gate('A2 correct table', before(RED_REQUIREMENTS, [`| 1.1 | x | ${H} |`, `| 1.2 | x | ${B} |`, `| 1.3 | x | ${H} |`]));
await gate('A3 unknown value on the break line (typo)', before(RED_REQUIREMENTS, [`| 1.1 | x | ${H} |`, '| 1.2 | x | Expected_Brek |', `| 1.3 | x | ${H} |`]));
await gate('A4 missing row for 1.2 (table exists)', before(RED_REQUIREMENTS, [`| 1.1 | x | ${H} |`, `| 1.3 | x | ${H} |`]));
await gate('A5 duplicated row, Break first then Hold', before(RED_REQUIREMENTS, [`| 1.2 | x | ${B} |`, `| 1.2 | y | ${H} |`]));
await gate('A5b duplicated row, Hold first then Break', before(RED_REQUIREMENTS, [`| 1.2 | x | ${H} |`, `| 1.2 | y | ${B} |`]));
await gate('A6 Expected_Break line that holds (GREEN controller)', before(GREEN_REQUIREMENTS, [`| 1.2 | x | ${B} |`]));
await gate('A7 mixed case', before(RED_REQUIREMENTS, ['| 1.1 | x | EXPECTED_HOLD |', '| 1.2 | x | expected break |', '| 1.3 | x | expected_hold |']));
await gate('A8 table after the requirements', after(RED_REQUIREMENTS, [`| 1.2 | x | ${B} |`]));
await gate('A9 CRLF everywhere', before(RED_REQUIREMENTS, [`| 1.2 | x | ${B} |`]).replace(/\r?\n/g, '\r\n'));
await gate('A10 CRLF, table after', after(RED_REQUIREMENTS, [`| 1.2 | x | ${B} |`]).replace(/\r?\n/g, '\r\n'));

// ---- B. hazards
await gate('B1 orphan row: id written R1.2 (mark silently lost)', before(RED_REQUIREMENTS, [`| R1.2 | x | ${B} |`]));
await gate('B2 orphan row: id 1.20 (typo)', before(RED_REQUIREMENTS, [`| 1.20 | x | ${B} |`]));
await gate('B3 table inside a fenced example block', RED_REQUIREMENTS.replace('### Requirement 1', '```md\n| Criterion | Topic | Expectation |\n|---|---|---|\n| 1.2 | x | Expected_Break |\n```\n\n### Requirement 1'));
await gate('B4 every line marked Expected_Break on a controller that breaks only 1.2', before(RED_REQUIREMENTS, [`| 1.1 | x | ${B} |`, `| 1.2 | x | ${B} |`, `| 1.3 | x | ${B} |`]));
await gate('B5 gaming: flip only the broken line to Expected_Break, same controller', before(RED_REQUIREMENTS, [`| 1.2 | x | ${B} |`]));
await gate('B6 --json with a table', before(RED_REQUIREMENTS, [`| 1.2 | x | ${B} |`]), '--json');
await gate('B7 --json unknown value', before(RED_REQUIREMENTS, ['| 1.2 | x | oops |']), '--json');

// ---- C. what the Stop hook shows the agent
await kiro('C1 kiro: Expected_Break line holds', before(GREEN_REQUIREMENTS, [`| 1.2 | x | ${B} |`]));
await kiro('C2 kiro: Expected_Hold line breaks (no table)', RED_REQUIREMENTS);
await kiro('C3 kiro: typo value on the break line', before(RED_REQUIREMENTS, [`| 1.1 | x | ${H} |`, '| 1.2 | x | Expected_Brek |']));
await kiro('C4 kiro: break line breaks (green)', before(RED_REQUIREMENTS, [`| 1.2 | x | ${B} |`]));
await kiro('C5 kiro: orphan id R1.2', before(RED_REQUIREMENTS, [`| R1.2 | x | ${B} |`]));
