// Probe 6: tables the author means as the Expectation table but the parser ignores without a word, and the prose form
// that the stagger-app spec (requirement 8) allows ("in a Glossary table or an Introduction paragraph").
// Run from skeleton/: npx tsx ../docs/reviews/gate-audit-probes/p6-header-and-prose.mts
import { parseExpectations } from '../../../skeleton/src/cli/expectation.js';

const row = '| 1.2 | Push | Expected_Break |';
const cases: [string, string][] = [
  ['header "Criteria | Topic | Expectation"', `| Criteria | Topic | Expectation |\n|---|---|---|\n${row}\n`],
  ['header "Criterion | Topic | Expectations"', `| Criterion | Topic | Expectations |\n|---|---|---|\n${row}\n`],
  ['header "ID | Topic | Expectation"', `| ID | Topic | Expectation |\n|---|---|---|\n${row}\n`],
  ['header "Criterion | Topic | Expected"', `| Criterion | Topic | Expected |\n|---|---|---|\n${row}\n`],
  ['Introduction paragraph: "1.2 is Expected_Break."', 'Introduction\n\n1.2 is Expected_Break. All other lines are Expected_Hold.\n'],
  ['bullet list: "- 1.2: Expected_Break"', '- 1.2: Expected_Break\n'],
  ['HTML table', '<table><tr><th>Criterion</th><th>Expectation</th></tr><tr><td>1.2</td><td>Expected_Break</td></tr></table>\n'],
];
for (const [name, text] of cases) {
  const r = parseExpectations(text);
  console.log(`${name.padEnd(55)} rows read: ${r.byId.size}  warnings: ${r.problems.length}`);
}
