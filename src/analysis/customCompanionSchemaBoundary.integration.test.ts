import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeMacroSet } from './analyzeMacroSet';
import { buildSchemaCoverage, type SchemaVersionAnalysis } from './schemaCoverage';
import type { AnalysisInput, MacroFile, SchemaObject, SchemaSnapshot } from './types';

const repositoryRoot = process.cwd();
const catalog = JSON.parse(readFileSync(
  resolve(repositoryRoot, 'public/schemas/catalog.json'),
  'utf8',
)) as {
  snapshots: Array<{
    id: string;
    release: string;
    label: string;
    channel: 'cloud' | 'on-premises';
    sha256: string;
    lastUpdated: string;
    objectCount: number;
    filename: string;
  }>;
};

const macroFiles: MacroFile[] = [
  {
    id: 'main',
    path: 'Custom-Campanion_1_Main_2026.js',
    source: [
      "import './Custom-Campanion_7_RoomReference_2026';",
      "import './Custom-Campanion_12_ParentCallCoordination_2026';",
    ].join('\n'),
  },
  {
    id: 'parent-call-coordination',
    path: 'Custom-Campanion_12_ParentCallCoordination_2026.js',
    source: [
      "import xapi from 'xapi';",
      'xapi.Event.CallDisconnect.on(() => {});',
      'xapi.Event.CallFailed.on(() => {});',
      'xapi.Status.Conference.Call.MeetingPlatform.get();',
      'xapi.Status.Conference.Call.Webex.MeetingInviteLink.get();',
    ].join('\n'),
  },
  {
    id: 'room-reference',
    path: 'Custom-Campanion_7_RoomReference_2026.js',
    source: [
      "import xapi from 'xapi';",
      'xapi.Status.SystemUnit.BroadcastName.get();',
    ].join('\n'),
  },
];

function analyzeSnapshot(catalogSnapshot: (typeof catalog.snapshots)[number]): SchemaVersionAnalysis {
  const rawSchema = JSON.parse(readFileSync(
    resolve(repositoryRoot, 'public/schemas', catalogSnapshot.filename),
    'utf8',
  )) as { objects: SchemaObject[] };
  const schemaSnapshot: SchemaSnapshot = {
    id: catalogSnapshot.id,
    release: catalogSnapshot.release,
    sha256: catalogSnapshot.sha256,
    upstreamUpdatedAt: catalogSnapshot.lastUpdated,
    objectCount: catalogSnapshot.objectCount,
    objects: rawSchema.objects,
  };
  const input = {
    macroSet: {
      files: macroFiles,
      entryMacroIds: ['main'],
    },
    target: { kind: 'exploratory', partial: { release: schemaSnapshot.release } },
    schemaSnapshot,
    rulePack: { id: 'roomos-macro-rules', version: '1.0.0', rules: [] },
    analysisTime: '2026-07-23T12:00:00.000Z',
  } satisfies AnalysisInput;
  const outcome = analyzeMacroSet(input);
  if (outcome.kind !== 'report') throw new Error(outcome.failure.message);
  return {
    version: {
      id: catalogSnapshot.id,
      release: catalogSnapshot.release,
      label: `RoomOS ${catalogSnapshot.label}`,
      channel: catalogSnapshot.channel,
      sha256: catalogSnapshot.sha256,
    },
    references: outcome.report.inventory.references,
  };
}

describe('Custom-Campanion schema-derived release boundary', () => {
  it('finds the earliest passing snapshot in each channel and preserves a later schema exception', () => {
    const coverage = buildSchemaCoverage(catalog.snapshots.map(analyzeSnapshot));

    expect(coverage.earliestCompatibleVersion).toEqual(expect.objectContaining({
      release: '11.19.1',
      channel: 'cloud',
    }));
    expect(coverage.compatibilityByChannel).toEqual([
      expect.objectContaining({
        channel: 'cloud',
        earliestCompatibleVersion: expect.objectContaining({ release: '11.19.1' }),
        latestCompatibleVersion: expect.objectContaining({ release: '26.7.1' }),
        latestCatalogVersion: expect.objectContaining({ release: '26.7.1' }),
        laterIncompatibleVersions: [
          expect.objectContaining({
            release: '11.26.1',
            missingReferences: expect.arrayContaining([
              expect.objectContaining({ kind: 'Event', path: 'CallDisconnect' }),
              expect.objectContaining({ kind: 'Event', path: 'CallFailed' }),
            ]),
          }),
        ],
      }),
      expect.objectContaining({
        channel: 'on-premises',
        earliestCompatibleVersion: expect.objectContaining({ release: '11.24.4.1' }),
        latestCompatibleVersion: expect.objectContaining({ release: '11.32.4.0' }),
        latestCatalogVersion: expect.objectContaining({ release: '11.32.4.0' }),
        laterIncompatibleVersions: [],
      }),
    ]);
  });
});
