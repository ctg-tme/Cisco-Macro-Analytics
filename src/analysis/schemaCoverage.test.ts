import { describe, expect, it } from 'vitest';
import { buildSchemaCoverage } from './schemaCoverage';
import type { ApiKind, SchemaEvidence } from './types';

const versions = [
  { id: 'v3', release: '3.0', label: 'RoomOS 3.0 March 2026', channel: 'cloud' as const, sha256: 'sha-3' },
  { id: 'v2', release: '2.0', label: 'RoomOS 2.0', channel: 'on-premises' as const, sha256: 'sha-2' },
  { id: 'v1', release: '1.0', label: 'RoomOS 1.0 January 2025', channel: 'cloud' as const, sha256: 'sha-1' },
];

function evidence(matchKind: SchemaEvidence['matchKind']): SchemaEvidence {
  return {
    existsInSnapshot: matchKind === 'exact' || matchKind === 'parent',
    matchKind,
    ...(matchKind === 'parent' ? {
      descendantCount: 2,
      descendantPaths: ['Video Input Connector Connected', 'Video Input Connector Type'],
    } : {}),
    documentationUrl: 'https://roomos.cisco.com/xapi/Status.Video.Input.Connector/',
    product: { status: 'not-declared', supportedProducts: [] },
    operatingMode: { status: 'not-declared', supportsMtr: null, basis: 'missing-metadata' },
    role: { status: 'not-declared', allowedRoles: [] },
    parameters: [],
  };
}

function reference(kind: ApiKind, path: string, matchKind: SchemaEvidence['matchKind']) {
  return { kind, path, schemaEvidence: evidence(matchKind) };
}

describe('buildSchemaCoverage', () => {
  it('keeps parent matches eligible with a warning and excludes missing versions', () => {
    const coverage = buildSchemaCoverage([
      {
        version: versions[0]!,
        references: [
          reference('Status', 'Video Input Connector', 'exact'),
          reference('Command', 'Audio Volume Set', 'exact'),
        ],
      },
      {
        version: versions[1]!,
        references: [
          reference('Status', 'Video Input Connector', 'parent'),
          reference('Command', 'Audio Volume Set', 'exact'),
        ],
      },
      {
        version: versions[2]!,
        references: [
          reference('Status', 'Video Input Connector', 'parent'),
          reference('Command', 'Audio Volume Set', 'none'),
        ],
      },
    ]);

    expect(coverage.compatibleVersions.map((version) => version.release)).toEqual(['3.0', '2.0']);
    expect(coverage.earliestCompatibleVersion).toEqual(expect.objectContaining({
      release: '2.0',
      channel: 'on-premises',
    }));
    expect(coverage.latestCompatibleVersion).toEqual(expect.objectContaining({
      release: '3.0',
      channel: 'cloud',
    }));
    expect(coverage.latestCatalogVersion).toEqual(expect.objectContaining({ release: '3.0' }));
    expect(coverage.compatibilityByChannel).toEqual([
      expect.objectContaining({
        channel: 'cloud',
        earliestCompatibleVersion: expect.objectContaining({ release: '3.0' }),
        latestCompatibleVersion: expect.objectContaining({ release: '3.0' }),
        latestCatalogVersion: expect.objectContaining({ release: '3.0' }),
        laterIncompatibleVersions: [],
      }),
      expect.objectContaining({
        channel: 'on-premises',
        earliestCompatibleVersion: expect.objectContaining({ release: '2.0' }),
        latestCompatibleVersion: expect.objectContaining({ release: '2.0' }),
        latestCatalogVersion: expect.objectContaining({ release: '2.0' }),
        laterIncompatibleVersions: [],
      }),
    ]);
    expect(coverage.exactCompatibleVersions.map((version) => version.release)).toEqual(['3.0']);
    expect(coverage.parentWarningVersions).toEqual([
      expect.objectContaining({
        release: '2.0',
        parentReferences: [{
          key: 'Status|Video Input Connector',
          kind: 'Status',
          path: 'Video Input Connector',
        }],
        missingReferences: [],
      }),
    ]);
    expect(coverage.incompatibleVersions).toEqual([
      expect.objectContaining({
        release: '1.0',
        missingPathCount: 1,
        parentPathCount: 1,
        parentReferences: [{
          key: 'Status|Video Input Connector',
          kind: 'Status',
          path: 'Video Input Connector',
        }],
        missingReferences: [{
          key: 'Command|Audio Volume Set',
          kind: 'Command',
          path: 'Audio Volume Set',
        }],
      }),
    ]);
    expect(coverage.references).toEqual([
      expect.objectContaining({
        kind: 'Command',
        path: 'Audio Volume Set',
        exactVersions: [versions[0], versions[1]],
        parentVersions: [],
        missingVersions: [versions[2]],
      }),
      expect.objectContaining({
        kind: 'Status',
        path: 'Video Input Connector',
        exactVersions: [versions[0]],
        parentVersions: [versions[1], versions[2]],
        missingVersions: [],
      }),
    ]);
  });

  it('treats a path as missing when its entire API kind is absent', () => {
    const coverage = buildSchemaCoverage([
      {
        version: versions[0]!,
        references: [reference('Event', 'CallDisconnect', 'exact')],
      },
      {
        version: versions[1]!,
        references: [reference('Event', 'CallDisconnect', 'none')],
      },
      {
        version: versions[2]!,
        references: [reference('Event', 'CallDisconnect', 'none')],
      },
    ]);

    expect(coverage.compatibleVersions.map((version) => version.release)).toEqual(['3.0']);
    expect(coverage.incompatibleVersions).toEqual([
      expect.objectContaining({
        release: '2.0',
        status: 'missing',
        missingPathCount: 1,
        missingReferences: [{
          key: 'Event|CallDisconnect',
          kind: 'Event',
          path: 'CallDisconnect',
        }],
      }),
      expect.objectContaining({
        release: '1.0',
        status: 'missing',
        missingPathCount: 1,
      }),
    ]);
    expect(coverage.references[0]).toEqual(expect.objectContaining({
      missingVersions: [versions[1], versions[2]],
    }));
  });

  it('reports later schema exceptions instead of assuming compatibility is monotonic', () => {
    const coverage = buildSchemaCoverage([
      {
        version: versions[0]!,
        references: [reference('Event', 'CallDisconnect', 'none')],
      },
      {
        version: versions[2]!,
        references: [reference('Event', 'CallDisconnect', 'exact')],
      },
    ]);

    expect(coverage.earliestCompatibleVersion).toEqual(expect.objectContaining({ release: '1.0' }));
    expect(coverage.compatibilityByChannel[0]).toEqual(expect.objectContaining({
      channel: 'cloud',
      earliestCompatibleVersion: expect.objectContaining({ release: '1.0' }),
      latestCompatibleVersion: expect.objectContaining({ release: '1.0' }),
      latestCatalogVersion: expect.objectContaining({ release: '3.0' }),
      laterIncompatibleVersions: [
        expect.objectContaining({ release: '3.0' }),
      ],
    }));
  });
});
