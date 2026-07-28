import type { MacroFile } from '../analysis/types';
import { parseMacroFile, walkAst } from '../analysis/internal/parser';

export interface MacroTelemetrySummary {
  macroCount: number;
  macrosWithImportSyntax: number;
  macrosWithExportSyntax: number;
  macrosWithImportOrExportSyntax: number;
}

/**
 * Reduces a Macro Set to the only source-derived values approved for Product
 * Telemetry. No source text, paths, names, hashes, or report data leave this
 * function.
 */
export function summarizeMacroSyntax(files: MacroFile[]): MacroTelemetrySummary {
  let macrosWithImportSyntax = 0;
  let macrosWithExportSyntax = 0;
  let macrosWithImportOrExportSyntax = 0;

  for (const file of files) {
    const result = parseMacroFile(file);
    if (result.kind !== 'parsed') continue;

    let hasImportSyntax = false;
    let hasExportSyntax = false;
    walkAst(result.parsed.program, (node) => {
      if (node.type === 'ImportDeclaration' || node.type === 'ImportExpression') {
        hasImportSyntax = true;
      }
      if (
        node.type === 'ExportNamedDeclaration'
        || node.type === 'ExportDefaultDeclaration'
        || node.type === 'ExportAllDeclaration'
      ) {
        hasExportSyntax = true;
      }
    });

    if (hasImportSyntax) macrosWithImportSyntax += 1;
    if (hasExportSyntax) macrosWithExportSyntax += 1;
    if (hasImportSyntax || hasExportSyntax) macrosWithImportOrExportSyntax += 1;
  }

  return {
    macroCount: files.length,
    macrosWithImportSyntax,
    macrosWithExportSyntax,
    macrosWithImportOrExportSyntax,
  };
}
