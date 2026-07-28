import { describe, expect, it } from 'vitest';
import { buildSourceSnippet } from './sourceSnippet';

function range(startLine: number, endLine = startLine) {
  return {
    start: { line: startLine, column: 1 },
    end: { line: endLine, column: 1 },
  };
}

describe('buildSourceSnippet', () => {
  it('includes three lines above and below the reported line', () => {
    const source = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n');

    const snippet = buildSourceSnippet(source, range(5));

    expect(snippet).toEqual({
      startLine: 2,
      endLine: 8,
      lines: [
        { number: 2, text: 'line 2', highlighted: false },
        { number: 3, text: 'line 3', highlighted: false },
        { number: 4, text: 'line 4', highlighted: false },
        { number: 5, text: 'line 5', highlighted: true },
        { number: 6, text: 'line 6', highlighted: false },
        { number: 7, text: 'line 7', highlighted: false },
        { number: 8, text: 'line 8', highlighted: false },
      ],
    });
  });

  it('clips context to the file boundaries and handles CRLF source', () => {
    const source = ['one', 'two', 'three', 'four'].join('\r\n');

    expect(buildSourceSnippet(source, range(2)).lines).toEqual([
      { number: 1, text: 'one', highlighted: false },
      { number: 2, text: 'two', highlighted: true },
      { number: 3, text: 'three', highlighted: false },
      { number: 4, text: 'four', highlighted: false },
    ]);
  });

  it('highlights every reported line in a multi-line range', () => {
    const source = Array.from({ length: 9 }, (_, index) => `line ${index + 1}`).join('\n');

    const snippet = buildSourceSnippet(source, range(4, 6), 2);

    expect(snippet.startLine).toBe(2);
    expect(snippet.endLine).toBe(8);
    expect(snippet.lines.filter((line) => line.highlighted).map((line) => line.number)).toEqual([4, 5, 6]);
  });
});
