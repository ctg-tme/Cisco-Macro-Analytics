import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { analyzeMacroSet } from '../analysis/analyzeMacroSet';
import {
  buildAnalysisSession,
  type AnalysisSessionResult,
} from '../analysis/analysisSession';
import { DEFAULT_RULE_PACK, resolveEffectiveRulePack } from '../analysis/rulePack';
import { buildSchemaCoverage } from '../analysis/schemaCoverage';
import type { AnalysisReport, SchemaSnapshot } from '../analysis/types';
import type { VerifiedSchemaProvenance } from '../schemaCatalog';
import {
  buildAnalysisExportEntries,
  createAnalysisExportArchive,
  type MacroAnalysisExport,
} from './analysisExport';

const analysisTime = '2026-07-29T14:00:00.000Z';

function snapshot(): SchemaSnapshot {
  return {
    id: 'roomos-26-7',
    release: '26.7.1',
    sha256: 'a'.repeat(64),
    objectCount: 2,
    objects: [
      {
        type: 'Status',
        path: 'Audio Volume',
        attributes: { role: ['Admin', 'Integrator', 'User'] },
      },
      {
        type: 'Status',
        path: 'Video Input MainVideoSource',
        attributes: { role: ['Admin', 'Integrator', 'User'] },
      },
    ],
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

function reportFor(schema: SchemaSnapshot): AnalysisReport {
  const outcome = analyzeMacroSet({
    macroSet: {
      files: [
        {
          id: 'main',
          path: 'main.js',
          source: [
            "import xapi from 'xapi';",
            "import './helpers/helper.js';",
            'xapi.Status.Audio.Volume.get();',
          ].join('\n'),
        },
        {
          id: 'helper',
          path: 'helpers/helper.js',
          source: [
            "import xapi from 'xapi';",
            'xapi.Status.Video.Input.MainVideoSource.get();',
          ].join('\n'),
        },
      ],
      entryMacroIds: ['main'],
    },
    target: { kind: 'exploratory', partial: { release: schema.release } },
    schemaSnapshot: schema,
    rulePack: DEFAULT_RULE_PACK,
    analysisTime,
  });
  if (outcome.kind !== 'report') throw new Error(outcome.failure.message);
  return outcome.report;
}

function sessionFixture(): AnalysisSessionResult {
  const schema = snapshot();
  const report = reportFor(schema);
  const version = {
    id: schema.id,
    release: schema.release,
    label: `RoomOS ${schema.release}`,
    channel: 'cloud' as const,
    sha256: schema.sha256,
  };
  return buildAnalysisSession({
    generatedAt: analysisTime,
    schemas: [{ provenance: provenance(schema), report }],
    comparison: buildSchemaCoverage([{ version, references: report.inventory.references }]),
    effectiveRulePack: resolveEffectiveRulePack(DEFAULT_RULE_PACK),
  });
}

describe('analysis ZIP export', () => {
  it('contains the full canonical session and one readable projection per macro', () => {
    const session = sessionFixture();
    const entries = buildAnalysisExportEntries(session);

    expect(Object.keys(entries)).toEqual([
      'full-analysis.json',
      'independent-macro-analysis/main_analysis.json',
      'independent-macro-analysis/helper_analysis.json',
    ]);
    expect(JSON.parse(strFromU8(entries['full-analysis.json']!))).toEqual(session);

    const main = JSON.parse(
      strFromU8(entries['independent-macro-analysis/main_analysis.json']!),
    ) as MacroAnalysisExport;
    const helper = JSON.parse(
      strFromU8(entries['independent-macro-analysis/helper_analysis.json']!),
    ) as MacroAnalysisExport;

    expect(main.exportKind).toBe('macro-analysis');
    expect(main.sessionId).toBe(session.sessionId);
    expect(main.macro.fileId).toBe('main');
    expect(helper.macro.fileId).toBe('helper');
    expect(main.schemas).toHaveLength(1);
    expect(main.schemas[0]!.references).not.toHaveLength(0);
    expect(helper.schemas[0]!.references).not.toHaveLength(0);
    expect(JSON.stringify({ main, helper })).not.toContain("import xapi from 'xapi'");
  });

  it('produces a valid ZIP archive without placing macro source in any JSON file', () => {
    const session = sessionFixture();
    const archive = unzipSync(createAnalysisExportArchive(session));

    expect(Object.keys(archive)).toEqual([
      'full-analysis.json',
      'independent-macro-analysis/main_analysis.json',
      'independent-macro-analysis/helper_analysis.json',
    ]);
    expect(JSON.parse(strFromU8(archive['full-analysis.json']!))).toEqual(session);
    expect(
      strFromU8(archive['independent-macro-analysis/main_analysis.json']!),
    ).not.toContain(
      'xapi.Status.Audio.Volume.get();',
    );
  });

  it('adds a suffix only when duplicate macro basenames would overwrite each other', () => {
    const session = sessionFixture();
    session.analyzedSourceSet.files
      .find((file) => file.fileId === 'helper')!.path = 'other/main.js';
    const entries = buildAnalysisExportEntries(session);

    expect(Object.keys(entries)).toContain(
      'independent-macro-analysis/main_analysis.json',
    );
    expect(Object.keys(entries)).toContain(
      'independent-macro-analysis/main_analysis_2.json',
    );
  });
});
