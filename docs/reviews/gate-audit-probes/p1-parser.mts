// Probe 1: parseExpectations on awkward tables. Run from skeleton/: npx tsx ../docs/reviews/gate-audit-probes/p1-parser.mts
import { parseExpectations } from '../../../skeleton/src/cli/expectation.js';

const show = (name: string, text: string): void => {
  const r = parseExpectations(text);
  console.log(`\n## ${name}`);
  console.log('byId    :', JSON.stringify([...r.byId]));
  console.log('problems:', JSON.stringify(r.problems));
};
const T = (rows: string[], head = '| Criterion | Topic | Expectation |\n|---|---|---|'): string => `${head}\n${rows.join('\n')}\n`;

show('unknown value (Expected_Brek)', T(['| 1.1 | A | Expected_Brek |']));
show('unknown value (Expected_Break (known gap))', T(['| 1.2 | A | Expected_Break (known gap) |']));
show('unknown value "Expected_Break." trailing dot', T(['| 1.2 | A | Expected_Break. |']));
show('unknown value "Expected_Pass"', T(['| 1.2 | A | Expected_Pass |']));
show('empty value', T(['| 1.2 | A |  |']));
show('short row (value cell missing)', T(['| 1.2 | A |']));
show('duplicate row, conflicting', T(['| 1.1 | A | Expected_Break |', '| 1.1 | B | Expected_Hold |']));
show('duplicate row, same value', T(['| 1.1 | A | Expected_Break |', '| 1.1 | B | Expected_Break |']));
show('duplicate, first invalid then valid', T(['| 1.1 | A | oops |', '| 1.1 | B | Expected_Break |']));
show('mixed case', T(['| 1.1 | A | EXPECTED_BREAK |', '| 1.2 | A | expected_hold |', '| 1.3 | A | Expected_break |', '| 1.4 | A | expected break |', '| 1.5 | A | ExpectedBreak |', '| 1.6 | A | expected-hold |']));
show('mixed case header', T(['| 1.1 | A | Expected_Break |'], '| CRITERION | Topic | EXPECTATION |\n|---|---|---|'));
show('bold/backtick cells', T(['| **1.1** | A | **Expected_Break** |', '| `1.2` | A | `Expected_Hold` |']));
show('CRLF', T(['| 1.1 | A | Expected_Break |', '| 1.2 | A | Expected_Hold |']).replace(/\n/g, '\r\n'));
show('lone CR (old Mac)', T(['| 1.1 | A | Expected_Break |']).replace(/\n/g, '\r'));
show('no table at all', '# Requirements\n\n### Requirement 1\n\n#### Acceptance Criteria\n\n1. THE robot SHALL x\n');
show('BOM at the start', `\uFEFF${T(['| 1.1 | A | Expected_Break |'])}`);
show('table after the requirements', '### Requirement 1\n\n#### Acceptance Criteria\n\n1. THE robot SHALL x\n\n## Notes\n\n' + T(['| 1.1 | A | Expected_Break |']));
show('table with no separator row', '| Criterion | Topic | Expectation |\n| 1.1 | A | Expected_Break |\n');
show('table without leading/trailing pipes', 'Criterion | Topic | Expectation\n--- | --- | ---\n1.1 | A | Expected_Break\n');
show('table in a fenced code block (an example, not data)', '```md\n' + T(['| 1.2 | A | Expected_Break |']) + '```\n');
show('id with prefix R / trailing dot / space', T(['| R1.1 | A | Expected_Break |', '| 1.2. | A | Expected_Break |', '| Req 1.3 | A | Expected_Break |', '| 1.4 and 1.5 | A | Expected_Break |']));
show('id range "1.1-1.3"', T(['| 1.1-1.3 | A | Expected_Break |']));
show('row for an id that does not exist (typo 1.20)', T(['| 1.20 | A | Expected_Break |']));
show('escaped pipe in topic', T(['| 1.1 | A \\| B | Expected_Break |']));
show('topic with a pipe inside backticks', T(['| 1.1 | `a|b` | Expected_Break |']));
show('two tables, second has a blank line between header and body', T(['| 1.1 | A | Expected_Hold |']) + '\n' + '| Criterion | Topic | Expectation |\n\n| 2.1 | A | Expected_Break |\n');
show('adjacent tables, no blank line (second header read as a row)', T(['| 1.1 | A | Expected_Hold |', '| Criterion | Topic | Expectation |', '|---|---|---|', '| 2.1 | A | Expected_Break |']));
show('header only mentions Criterion and Expectation as words in a glossary table', '| Term | Meaning |\n|---|---|\n| Criterion | a test |\n| Expectation | a mark |\n');
show('column order swapped', '| Expectation | Criterion |\n|---|---|\n| Expected_Break | 1.2 |\n');
show('alignment colons in separator', T(['| 1.1 | A | Expected_Break |'], '| Criterion | Topic | Expectation |\n|:---|:---:|---:|'));
show('table indented 4 spaces (code block in markdown)', T(['| 1.1 | A | Expected_Break |']).split('\n').map((l) => (l === '' ? l : `    ${l}`)).join('\n'));
show('table inside a blockquote/list', T(['| 1.1 | A | Expected_Break |']).split('\n').map((l) => (l === '' ? l : `> ${l}`)).join('\n'));
show('prototype-ish id', T(['| __proto__ | A | Expected_Break |', '| constructor | A | Expected_Break |']));
show('first-column cell is a markdown link', T(['| [1.1](#r1) | A | Expected_Break |']));
show('value is HTML-commented', T(['| 1.1 | A | <!-- x --> Expected_Break |']));
