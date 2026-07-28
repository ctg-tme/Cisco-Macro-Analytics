import { describe, expect, it } from 'vitest';
import type {
  ApiKind,
  ApiReference,
  FileInventoryEntry,
  SchemaEvidence,
} from '../analysis/types';
import { groupReferences, groupReferencesByMacro } from './referenceGroups';

const schemaEvidence: SchemaEvidence = {
  existsInSnapshot: true,
  matchKind: 'exact',
  documentationUrl: 'https://roomos.cisco.com/xapi',
  product: { status: 'not-declared', supportedProducts: [] },
  operatingMode: {
    status: 'not-declared',
    supportsMtr: null,
    basis: 'missing-metadata',
  },
  role: { status: 'not-declared', allowedRoles: [] },
  parameters: [],
};

function reference(
  id: string,
  fileId: string,
  kind: ApiKind,
  path: string,
): ApiReference {
  return {
    id,
    observationId: `${id}-observation`,
    kind,
    path,
    operation: kind === 'Command' ? 'execute' : 'get',
    syntax: 'modern',
    availability: 'available-in-selected-schema',
    schemaEvidence,
    entryMacroIds: [fileId],
    source: {
      fileId,
      fileContentHash: `${fileId}-hash`,
      range: {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 10 },
      },
    },
  };
}

const files: FileInventoryEntry[] = [
  {
    fileId: 'beta',
    path: 'macros/beta.js',
    contentHash: 'beta-hash',
    roles: ['Entry'],
    activeState: 'Unknown',
    analysisState: 'Evaluated',
    affectedEntryMacroIds: ['beta'],
  },
  {
    fileId: 'alpha',
    path: 'macros/alpha.js',
    contentHash: 'alpha-hash',
    roles: ['Entry'],
    activeState: 'Unknown',
    analysisState: 'Evaluated',
    affectedEntryMacroIds: ['alpha'],
  },
];

describe('xAPI reference groups', () => {
  it('keeps the global unique-path grouping used by summary and coverage views', () => {
    const groups = groupReferences([
      reference('alpha-volume', 'alpha', 'Status', 'Audio Volume'),
      reference('beta-volume', 'beta', 'Status', 'Audio Volume'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.references).toHaveLength(2);
  });

  it('organizes references by source macro and lists unique xAPIs within each macro', () => {
    const groups = groupReferencesByMacro(files, [
      reference('beta-volume', 'beta', 'Status', 'Audio Volume'),
      reference('alpha-volume-1', 'alpha', 'Status', 'Audio Volume'),
      reference('alpha-volume-2', 'alpha', 'Status', 'Audio Volume'),
      reference('alpha-set', 'alpha', 'Command', 'Audio Volume Set'),
    ]);

    expect(groups.map((group) => ({
      fileId: group.fileId,
      title: group.title,
      totalUses: group.totalUses,
      xapis: group.referenceGroups.map((referenceGroup) => ({
        key: referenceGroup.key,
        uses: referenceGroup.references.length,
      })),
    }))).toEqual([
      {
        fileId: 'alpha',
        title: 'macros/alpha.js',
        totalUses: 3,
        xapis: [
          { key: 'Command|Audio Volume Set', uses: 1 },
          { key: 'Status|Audio Volume', uses: 2 },
        ],
      },
      {
        fileId: 'beta',
        title: 'macros/beta.js',
        totalUses: 1,
        xapis: [
          { key: 'Status|Audio Volume', uses: 1 },
        ],
      },
    ]);
  });
});
