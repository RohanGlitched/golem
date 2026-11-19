// Independent reference for line and column. It looks only at the input prefix
// and shares no code with the tokenizer.

/**
 * Line (from 1) and column (from 1, UTF-16 code units) of the code unit at `offset`.
 * A break is `\n`; `\r\n` is one break because its `\r` is an ordinary character
 * on the line it ends. A lone `\r` is not a break.
 */
export function refLineColumn(input: string, offset: number): { line: number; column: number } {
  const prefixLines = input.slice(0, offset).split('\n');
  return {
    line: prefixLines.length,
    column: prefixLines[prefixLines.length - 1]!.length + 1,
  };
}
