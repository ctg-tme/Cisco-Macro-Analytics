import { describe, expect, it } from 'vitest';
import {
  DEPENDENCY_MAP_EXAMPLE_ENTRY_ID,
  dependencyMapExampleFiles,
} from '../examples/dependencyMapExample';
import { buildImportGraph } from './internal/importGraph';
import { buildIncludedMacroSet } from './macroSetSelection';

describe('Macro Set inclusion', () => {
  it('omits unchecked files before Entry inference and dependency resolution', () => {
    const macroSet = buildIncludedMacroSet(dependencyMapExampleFiles.map((file) => ({
      file,
      included: file.id === DEPENDENCY_MAP_EXAMPLE_ENTRY_ID,
    })));
    const graph = buildImportGraph(macroSet.files, macroSet.entryMacroIds);

    expect(macroSet.files.map((file) => file.id)).toEqual([
      DEPENDENCY_MAP_EXAMPLE_ENTRY_ID,
    ]);
    expect(macroSet.entryMacroIds).toEqual([DEPENDENCY_MAP_EXAMPLE_ENTRY_ID]);
    expect(graph.directEdges).toEqual([]);
    expect(graph.unresolved.map((edge) => edge.normalizedExpectedPath).sort()).toEqual([
      'room-controls.js',
      'room-telemetry.js',
    ]);
  });

  it('resolves the complete example when every file is included', () => {
    const macroSet = buildIncludedMacroSet(dependencyMapExampleFiles.map((file) => ({
      file,
      included: true,
    })));
    const graph = buildImportGraph(macroSet.files, macroSet.entryMacroIds);

    expect(macroSet.files).toHaveLength(3);
    expect(macroSet.entryMacroIds).toEqual([DEPENDENCY_MAP_EXAMPLE_ENTRY_ID]);
    expect(graph.directEdges).toHaveLength(3);
    expect(graph.unresolved).toEqual([]);
  });
});
