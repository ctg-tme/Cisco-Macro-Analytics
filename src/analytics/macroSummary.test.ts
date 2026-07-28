import { describe, expect, it } from 'vitest';
import { summarizeMacroSyntax } from './macroSummary';

describe('Macro Product Telemetry summary', () => {
  it('counts macros with import and export syntax without retaining submitted values', () => {
    const summary = summarizeMacroSyntax([
      {
        id: 'private-controller',
        path: 'private-controller.js',
        source: "import xapi from 'xapi';\nexport default function start() {}",
      },
      {
        id: 'private-helper',
        path: 'private-helper.js',
        source: 'export const helper = true;',
      },
      {
        id: 'private-standalone',
        path: 'private-standalone.js',
        source: 'console.log("private source value");',
      },
    ]);

    expect(summary).toEqual({
      macroCount: 3,
      macrosWithImportSyntax: 1,
      macrosWithExportSyntax: 2,
      macrosWithImportOrExportSyntax: 2,
    });
    expect(JSON.stringify(summary)).not.toMatch(/private|controller|helper|standalone|source value/);
  });

  it('counts dynamic import syntax and safely skips files that do not parse', () => {
    expect(summarizeMacroSyntax([
      { id: 'dynamic', path: 'dynamic.js', source: "void import('./helper.js');" },
      { id: 'invalid', path: 'invalid.js', source: 'const =' },
    ])).toEqual({
      macroCount: 2,
      macrosWithImportSyntax: 1,
      macrosWithExportSyntax: 0,
      macrosWithImportOrExportSyntax: 1,
    });
  });
});
