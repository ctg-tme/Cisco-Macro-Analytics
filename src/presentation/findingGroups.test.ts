import { describe, expect, it } from 'vitest';
import type { FileInventoryEntry, Finding } from '../analysis/types';
import { groupFindingsByMacro } from './findingGroups';

function finding(
  id: string,
  priority: Finding['priority'],
  sourceFileIds: string[],
): Finding {
  return {
    id,
    rule: {
      id,
      version: '1.0.0',
      applicability: 'target-independent',
      evidenceRequirements: ['fixture'],
    },
    code: id,
    title: id,
    summary: id,
    category: 'Syntax',
    evidence: 'observed-finding',
    priority,
    observationIds: [`${id}-observation`],
    sourceFileIds,
    affectedEntryMacroIds: ['entry'],
    technicalBasis: 'fixture',
    limitations: ['fixture'],
    recommendedAction: 'fixture',
  };
}

const files: FileInventoryEntry[] = [
  {
    fileId: 'alpha',
    path: 'alpha.js',
    contentHash: 'alpha',
    roles: ['Entry'],
    activeState: 'Unknown',
    analysisState: 'Evaluated',
    affectedEntryMacroIds: ['alpha'],
  },
  {
    fileId: 'beta',
    path: 'beta.js',
    contentHash: 'beta',
    roles: ['Dependency'],
    activeState: 'Unknown',
    analysisState: 'Evaluated',
    affectedEntryMacroIds: ['alpha'],
  },
  {
    fileId: 'gamma',
    path: 'gamma.js',
    contentHash: 'gamma',
    roles: ['Entry'],
    activeState: 'Unknown',
    analysisState: 'Evaluated',
    affectedEntryMacroIds: ['gamma'],
  },
];

describe('groupFindingsByMacro', () => {
  it('groups single-source Findings by macro and keeps multi-source Findings in one coordination group', () => {
    const groups = groupFindingsByMacro(files, [
      finding('alpha-warning', 'warning', ['alpha']),
      finding('alpha-required', 'required', ['alpha']),
      finding('beta-advisory', 'advisory', ['beta']),
      finding('shared-info', 'informational', ['alpha', 'beta']),
    ]);

    expect(groups.map(({ key, kind, title, counts, findings }) => ({
      key,
      kind,
      title,
      counts,
      findingIds: findings.map((item) => item.id),
    }))).toEqual([
      {
        key: 'macro:alpha',
        kind: 'macro',
        title: 'alpha.js',
        counts: { required: 1, warning: 1, advisory: 0, informational: 0 },
        findingIds: ['alpha-required', 'alpha-warning'],
      },
      {
        key: 'macro:beta',
        kind: 'macro',
        title: 'beta.js',
        counts: { required: 0, warning: 0, advisory: 1, informational: 0 },
        findingIds: ['beta-advisory'],
      },
      {
        key: 'cross-macro',
        kind: 'cross-macro',
        title: 'Cross-macro coordination',
        counts: { required: 0, warning: 0, advisory: 0, informational: 1 },
        findingIds: ['shared-info'],
      },
    ]);
  });

  it('orders macro groups from highest Review Priority to lowest', () => {
    const groups = groupFindingsByMacro(files, [
      finding('alpha-advisory', 'advisory', ['alpha']),
      finding('beta-warning', 'warning', ['beta']),
      finding('gamma-required', 'required', ['gamma']),
      finding('shared-required', 'required', ['alpha', 'beta']),
    ]);

    expect(groups.map((group) => group.key)).toEqual([
      'macro:gamma',
      'macro:beta',
      'macro:alpha',
      'cross-macro',
    ]);
  });
});
