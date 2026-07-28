import { describe, expect, it } from 'vitest';
import { buildImportGraph } from '../analysis/internal/importGraph';
import {
  DEPENDENCY_MAP_EXAMPLE_ENTRY_ID,
  dependencyMapExampleFiles,
} from './dependencyMapExample';

describe('dependency map example', () => {
  it('has two entry dependencies and a relationship between those dependencies', () => {
    const graph = buildImportGraph(
      dependencyMapExampleFiles,
      [DEPENDENCY_MAP_EXAMPLE_ENTRY_ID],
    );
    const relationships = graph.directEdges
      .map((edge) => `${edge.importer.id}->${edge.dependency.id}`)
      .sort();

    expect(relationships).toEqual([
      'example-room-controller->example-room-controls',
      'example-room-controller->example-room-telemetry',
      'example-room-controls->example-room-telemetry',
    ]);
    expect(graph.reachable.map((file) => file.id).sort()).toEqual([
      'example-room-controller',
      'example-room-controls',
      'example-room-telemetry',
    ]);
    expect(graph.unresolved).toEqual([]);
  });
});
