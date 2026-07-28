import type { SourceRange } from '../analysis/types';

export interface SourceSnippetLine {
  number: number;
  text: string;
  highlighted: boolean;
}

export interface SourceSnippet {
  startLine: number;
  endLine: number;
  lines: SourceSnippetLine[];
}

export function buildSourceSnippet(
  source: string,
  range: SourceRange,
  contextLines = 3,
): SourceSnippet {
  const sourceLines = source.split(/\r?\n/);
  const lastLine = sourceLines.length;
  const targetStart = Math.min(Math.max(range.start.line, 1), lastLine);
  const targetEnd = Math.min(Math.max(range.end.line, targetStart), lastLine);
  const startLine = Math.max(1, targetStart - contextLines);
  const endLine = Math.min(lastLine, targetEnd + contextLines);
  const lines: SourceSnippetLine[] = [];

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    lines.push({
      number: lineNumber,
      text: sourceLines[lineNumber - 1] ?? '',
      highlighted: lineNumber >= targetStart && lineNumber <= targetEnd,
    });
  }

  return { startLine, endLine, lines };
}
