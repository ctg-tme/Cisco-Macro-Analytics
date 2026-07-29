import { describe, expect, it } from 'vitest';
import { analyzeMacroSet } from './analyzeMacroSet';
import {
  buildAnalysisSession,
  type AnalysisSessionResult,
} from './analysisSession';
import { parseAnalysisSessionJson } from './analysisSessionImport';
import { DEFAULT_RULE_PACK, resolveEffectiveRulePack } from './rulePack';
import { buildSchemaCoverage } from './schemaCoverage';
import type { SchemaSnapshot } from './types';

const analysisTime = '2026-07-29T14:00:00.000Z';

function sessionFixture(): AnalysisSessionResult {
  const schema: SchemaSnapshot = {
    id: 'roomos-26-7',
    release: '26.7.1',
    sha256: 'a'.repeat(64),
    objectCount: 1,
    objects: [{
      type: 'Status',
      path: 'Audio Volume',
      attributes: { role: ['Admin', 'Integrator', 'User'] },
    }],
    upstreamUpdatedAt: '2026-07-01T00:00:00.000Z',
  };
  const outcome = analyzeMacroSet({
    macroSet: {
      files: [{
        id: 'main',
        path: 'main.js',
        source: "import xapi from 'xapi';\nxapi.Status.Audio.Volume.get();",
      }],
      entryMacroIds: ['main'],
    },
    target: { kind: 'exploratory', partial: { release: schema.release } },
    schemaSnapshot: schema,
    rulePack: DEFAULT_RULE_PACK,
    analysisTime,
  });
  if (outcome.kind !== 'report') throw new Error(outcome.failure.message);
  const version = {
    id: schema.id,
    release: schema.release,
    label: `RoomOS ${schema.release}`,
    channel: 'cloud' as const,
    sha256: schema.sha256,
  };
  return buildAnalysisSession({
    generatedAt: analysisTime,
    schemas: [{
      provenance: {
        schemaId: schema.id,
        release: schema.release,
        filename: `${schema.release}.json`,
        upstreamUpdatedAt: schema.upstreamUpdatedAt,
        expectedSha256: schema.sha256,
        actualSha256: schema.sha256,
        byteSize: 100,
        verified: true,
      },
      report: outcome.report,
    }],
    comparison: buildSchemaCoverage([{
      version,
      references: outcome.report.inventory.references,
    }]),
    effectiveRulePack: resolveEffectiveRulePack(DEFAULT_RULE_PACK),
  });
}

describe('Analysis Session JSON import', () => {
  it('accepts a complete exported Analysis Session Result', () => {
    const session = sessionFixture();

    expect(parseAnalysisSessionJson(JSON.stringify(session))).toEqual(session);
  });

  it('rejects an independent per-Macro projection with a focused explanation', () => {
    expect(() => parseAnalysisSessionJson(JSON.stringify({
      schemaVersion: '1.0.0',
      exportKind: 'macro-analysis',
    }))).toThrow(
      'Choose full-analysis.json; files from independent-macro-analysis do not contain the complete session.',
    );
  });

  it('rejects malformed JSON and invalid report provenance', () => {
    expect(() => parseAnalysisSessionJson('{not-json')).toThrow(
      'The selected file is not valid JSON.',
    );

    const session = sessionFixture();
    session.schemas[0]!.provenance.actualSha256 = 'different';
    expect(() => parseAnalysisSessionJson(JSON.stringify(session))).toThrow(
      'Schema 1 does not contain matching verified provenance.',
    );
  });
});
