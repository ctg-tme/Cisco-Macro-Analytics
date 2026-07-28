import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateAndroidContainerReadiness } from '../presentation/androidContainerReadiness';
import { analyzeMacroSet } from './analyzeMacroSet';
import type { AnalysisInput, ApiReference, SchemaObject, SchemaSnapshot } from './types';

const repositoryRoot = process.cwd();
const catalog = JSON.parse(readFileSync(
  resolve(repositoryRoot, 'public/schemas/catalog.json'),
  'utf8',
)) as {
  snapshots: Array<{
    id: string;
    release: string;
    sha256: string;
    lastUpdated: string;
    objectCount: number;
    filename: string;
  }>;
};
const latestCatalogSnapshot = catalog.snapshots[0];
if (!latestCatalogSnapshot) throw new Error('The RoomOS schema catalog is empty.');
const rawSchema = JSON.parse(readFileSync(
  resolve(repositoryRoot, 'public/schemas', latestCatalogSnapshot.filename),
  'utf8',
)) as { objects: SchemaObject[] };

const schemaSnapshot: SchemaSnapshot = {
  id: latestCatalogSnapshot.id,
  release: latestCatalogSnapshot.release,
  sha256: latestCatalogSnapshot.sha256,
  upstreamUpdatedAt: latestCatalogSnapshot.lastUpdated,
  objectCount: latestCatalogSnapshot.objectCount,
  objects: rawSchema.objects,
};

function analyzeFixture(filename: string) {
  const source = readFileSync(resolve(repositoryRoot, 'testMacros', filename), 'utf8');
  const input: AnalysisInput = {
    macroSet: {
      files: [{ id: filename, path: filename, source }],
      entryMacroIds: [filename],
    },
    target: { kind: 'exploratory', partial: { release: schemaSnapshot.release } },
    schemaSnapshot,
    rulePack: {
      id: 'roomos-macro-rules',
      version: '1.0.0',
      rules: [{
        id: 'syntax.commonjs',
        kind: 'commonjs-deprecation',
        title: 'CommonJS macro syntax is deprecated',
        citation: 'https://roomos.cisco.com/doc/TechDocs/MacroTutorial',
        appliesTo: { minimumRelease: '11.0.0' },
      }],
    },
    analysisTime: '2026-07-23T12:00:00.000Z',
  };
  return analyzeMacroSet(input);
}

function syntaxes(references: ApiReference[]): string[] {
  return [...new Set(references.map((reference) => reference.syntax))].sort();
}

describe(`testMacros against latest RoomOS ${schemaSnapshot.release}`, () => {
  it.each([
    ['test_01_new_Syntax.js', ['modern']],
    ['test_02_old_Syntax.js', ['legacy']],
    ['test_03_mix_Syntax.js', ['legacy', 'modern']],
    ['test_04_depricated_syntax.js', ['modern']],
  ])('analyzes %s with the expected syntax coverage', (filename, expectedSyntax) => {
    const result = analyzeFixture(filename);

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.coverage.files).toEqual({
      supplied: 1,
      reachable: 1,
      parsed: 1,
      failed: 0,
      notInAnalyzedGraph: 0,
    });
    expect(result.report.inventory.references.length).toBeGreaterThan(0);
    expect(syntaxes(result.report.inventory.references)).toEqual(expectedSyntax);
    expect(result.report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'schema.api-not-available' }),
      expect.objectContaining({ code: 'coverage.parse-failure' }),
    ]));
  });

  it('interprets MTR evidence according to each xAPI kind convention', () => {
    const result = analyzeFixture('test_01_new_Syntax.js');

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    const evidenceByPath = Object.fromEntries(
      result.report.inventory.references.map((reference) => [
        `${reference.kind}|${reference.path}`,
        {
          supportsMtr: reference.schemaEvidence.operatingMode.supportsMtr,
          basis: reference.schemaEvidence.operatingMode.basis,
        },
      ]),
    );
    expect(evidenceByPath).toEqual({
      'Command|Audio Volume Set': {
        supportsMtr: true,
        basis: 'teams-unavailable-state',
      },
      'Command|UserInterface Extensions Panel Save': {
        supportsMtr: true,
        basis: 'teams-unavailable-state',
      },
      'Command|UserInterface Extensions Widget Action': {
        supportsMtr: true,
        basis: 'teams-unavailable-state',
      },
      'Command|UserInterface Message Alert Display': {
        supportsMtr: true,
        basis: 'teams-unavailable-state',
      },
      'Configuration|Audio DefaultVolume': {
        supportsMtr: false,
        basis: 'extension-marker',
      },
      'Event|UserInterface Extensions Panel Clicked': {
        supportsMtr: true,
        basis: 'feature-dependent-event',
      },
      'Status|Audio Volume': {
        supportsMtr: true,
        basis: 'extension-marker',
      },
    });
    expect(calculateAndroidContainerReadiness(result.report.inventory.references)).toEqual(
      expect.objectContaining({
        total: 7,
        available: 6,
        unavailable: 1,
        unknown: 0,
        notFound: 0,
        determined: 7,
        percentage: 86,
        issues: [{
          key: 'Configuration|Audio DefaultVolume',
          kind: 'Configuration',
          path: 'Audio DefaultVolume',
          reason: 'explicitly-unavailable',
        }],
      }),
    );
  });

  it('recognizes Video Input Connector as a parent of real schema paths', () => {
    const result = analyzeMacroSet({
      ...({
        macroSet: {
          files: [{
            id: 'parent-status',
            path: 'parent-status.js',
            source: "import xapi from 'xapi';\nxapi.Status.Video.Input.Connector.get();",
          }],
          entryMacroIds: ['parent-status'],
        },
        target: { kind: 'exploratory', partial: { release: schemaSnapshot.release } },
        schemaSnapshot,
        rulePack: { id: 'roomos-macro-rules', version: '1.0.0', rules: [] },
        analysisTime: '2026-07-23T12:00:00.000Z',
      } satisfies AnalysisInput),
    });

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.inventory.references[0]?.schemaEvidence).toEqual(expect.objectContaining({
      existsInSnapshot: true,
      matchKind: 'parent',
      descendantCount: expect.any(Number),
      descendantPaths: expect.arrayContaining([
        'Video Input Connector Connected',
        'Video Input Connector SignalState',
        'Video Input Connector SourceId',
        'Video Input Connector Type',
      ]),
    }));
    expect(result.report.inventory.references[0]?.schemaEvidence.descendantCount).toBeGreaterThan(0);
    expect(result.report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'schema.parent-path-match' }),
    ]));
    expect(result.report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'coverage.declared-target-incomplete',
      }),
    ]));
  });

  it('does not mistake an awaited xAPI result for an unresolved alias', () => {
    const result = analyzeFixture('test_04_depricated_syntax.js');

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.inventory.references).toEqual([
      expect.objectContaining({
        kind: 'Status',
        path: 'Audio Volume',
        operation: 'get',
      }),
    ]);
    expect(result.report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'coverage.unresolved-xapi-alias' }),
    ]));
    expect(result.report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'source.commonjs-migration',
        evidence: 'observed-finding',
        priority: 'required',
      }),
    ]));
  });
});
