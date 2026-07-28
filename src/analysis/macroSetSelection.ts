import { defaultEntryMacroIds } from './internal/importGraph';
import type { MacroFile, MacroSet } from './types';

export interface MacroInclusionSelection {
  file: MacroFile;
  included: boolean;
}

export function buildIncludedMacroSet(
  selections: MacroInclusionSelection[],
): MacroSet {
  const files = selections
    .filter((selection) => selection.included)
    .map((selection) => selection.file);
  return {
    files,
    entryMacroIds: defaultEntryMacroIds(files),
  };
}
