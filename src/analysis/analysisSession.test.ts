import { describe, expect, it } from 'vitest';
import { analyzeMacroSet } from './analyzeMacroSet';
import {
  buildAnalysisSession,
  deriveAnalysisSessionPresentation,
  type AnalysisSessionResult,
} from './analysisSession';
import { DEFAULT_RULE_PACK, resolveEffectiveRulePack } from './rulePack';
import { buildSchemaCoverage } from './schemaCoverage';
import type { AnalysisReport, SchemaSnapshot } from './types';
import type { VerifiedSchemaProvenance } from '../schemaCatalog';

const analysisTime = '2026-07-28T18:00:00.000Z';
const source = [
  "import xapi from 'xapi';",
  'xapi.Status.Audio.Volume.get();',
  'xapi.Status.Audio.Volume.on(() => {});',
  'xapi.Status.Audio.Volume.on(() => {});',
].join('\n');

function analyze(snapshot: SchemaSnapshot): AnalysisReport {
  const outcome = analyzeMacroSet({
    macroSet: {
      files: [{ id: 'main', path: 'main.js', source }],
      entryMacroIds: ['main'],
    },
    target: { kind: 'exploratory', partial: { release: snapshot.release } },
    schemaSnapshot: snapshot,
    rulePack: DEFAULT_RULE_PACK,
    analysisTime,
  });
  if (outcome.kind !== 'report') throw new Error(outcome.failure.message);
  return outcome.report;
}

function snapshot(id: string, release: string, sha256: string): SchemaSnapshot {
  return {
    id,
    release,
    sha256,
    objectCount: 1,
    objects: [{
      type: 'Status',
      path: 'Audio Volume',
      attributes: { role: ['Admin', 'Integrator', 'User'] },
    }],
    upstreamUpdatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function provenance(schema: SchemaSnapshot): VerifiedSchemaProvenance {
  return {
    schemaId: schema.id,
    release: schema.release,
    filename: `${schema.release}.json`,
    upstreamUpdatedAt: schema.upstreamUpdatedAt,
    expectedSha256: schema.sha256,
    actualSha256: schema.sha256,
    byteSize: 100,
    verified: true,
  };
}

describe('canonical analysis session', () => {
  it('is the shared source for cross-schema UI values and JSON export evidence', () => {
    const latest = snapshot('latest', '26.7.1', 'a'.repeat(64));
    const earlier = snapshot('earlier', '26.6.1', 'b'.repeat(64));
    const latestReport = analyze(latest);
    const earlierReport = analyze(earlier);
    const coverage = buildSchemaCoverage([
      {
        version: {
          id: latest.id,
          release: latest.release,
          label: `RoomOS ${latest.release}`,
          channel: 'cloud',
          sha256: latest.sha256,
        },
        references: latestReport.inventory.references,
      },
      {
        version: {
          id: earlier.id,
          release: earlier.release,
          label: `RoomOS ${earlier.release}`,
          channel: 'cloud',
          sha256: earlier.sha256,
        },
        references: earlierReport.inventory.references,
      },
    ]);

    const session = buildAnalysisSession({
      generatedAt: analysisTime,
      schemas: [
        { provenance: provenance(latest), report: latestReport },
        { provenance: provenance(earlier), report: earlierReport },
      ],
      comparison: coverage,
      effectiveRulePack: resolveEffectiveRulePack(DEFAULT_RULE_PACK),
    });
    const presentation = deriveAnalysisSessionPresentation(session);
    const exported = JSON.parse(JSON.stringify(session)) as AnalysisSessionResult;

    expect(exported.schemas).toHaveLength(2);
    expect(exported.schemas.every((item) => item.provenance.verified)).toBe(true);
    expect(exported.effectiveRulePack.rules).toHaveLength(25);
    expect(presentation.summary.schemaSnapshots).toBe(exported.comparison.totalVersions);
    expect(presentation.summary.subscriptionRegistrations)
      .toBe(exported.analytics.subscriptions.totalRegistrations);
    expect(presentation.summary.uniqueSubscribedPaths)
      .toBe(exported.analytics.subscriptions.uniqueSubscribedPaths);
    expect(presentation.summary.entryMacros).toBe(exported.analyzedSourceSet.entryMacroIds.length);
    expect(presentation.displayReport.findings.length).toBe(
      exported.schemas[0]!.report.findings.filter((finding) =>
        !presentation.omittedPerSnapshotFindingCodes.includes(finding.code)).length,
    );
  });
});
