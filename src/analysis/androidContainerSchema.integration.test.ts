import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeMacroSet } from './analyzeMacroSet';
import type { AnalysisInput, SchemaObject, SchemaSnapshot } from './types';

const repositoryRoot = process.cwd();

function schemaSnapshot(filename: string): SchemaSnapshot {
  const raw = JSON.parse(readFileSync(
    resolve(repositoryRoot, 'xapiSchemas', filename),
    'utf8',
  )) as { objects: SchemaObject[] };
  const release = filename.replace(/\.json$/i, '').split(' ')[0]!;
  return {
    id: `roomos-${release}-integration`,
    release,
    sha256: 'integration-fixture',
    upstreamUpdatedAt: '2026-07-28T00:00:00.000Z',
    objectCount: raw.objects.length,
    objects: raw.objects,
  };
}

function analyzeStatus(snapshot: SchemaSnapshot) {
  const input: AnalysisInput = {
    macroSet: {
      files: [{
        id: 'main',
        path: 'main.js',
        source: "import xapi from 'xapi';\nxapi.Status.Audio.Volume.get();",
      }],
      entryMacroIds: ['main'],
    },
    target: {
      kind: 'declared',
      release: snapshot.release,
      productModel: 'barents',
      operatingMode: 'MTR',
      runtimeRole: 'Integrator',
    },
    schemaSnapshot: snapshot,
    rulePack: { id: 'roomos-macro-rules', version: '1.0.0', rules: [] },
    analysisTime: '2026-07-28T00:00:00.000Z',
  };
  return analyzeMacroSet(input);
}

describe('Android Container schema capability', () => {
  it.each([
    '9.15.17.4.json',
    '10.19.4.2.json',
  ])('treats metadata-free RoomOS %s as unsupported', (filename) => {
    const result = analyzeStatus(schemaSnapshot(filename));

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.provenance.analyzer).toEqual({
      name: 'Cisco Macro Analyzer',
      version: '2.2.1',
    });
    expect(result.report.inventory.references[0]).toEqual(expect.objectContaining({
      availability: 'unavailable-for-mode',
      schemaEvidence: expect.objectContaining({
        operatingMode: {
          status: 'not-supported',
          declaredMode: 'MTR',
          supportsMtr: false,
          basis: 'missing-metadata',
        },
      }),
    }));
  });

  it('uses the extension allowlist once RoomOS publishes container metadata', () => {
    const result = analyzeStatus(schemaSnapshot('11.14.4.0.json'));

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.inventory.references[0]?.schemaEvidence.operatingMode).toEqual({
      status: 'supported',
      declaredMode: 'MTR',
      supportsMtr: true,
      basis: 'extension-marker',
    });
  });
});
