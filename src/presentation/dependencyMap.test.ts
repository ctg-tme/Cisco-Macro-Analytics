import { describe, expect, it } from 'vitest';
import type { AnalysisReport } from '../analysis/types';
import {
  buildDependencyMap,
  renderDependencyMapSvg,
} from './dependencyMap';

const sourceReference = {
  fileId: 'main',
  fileContentHash: 'a'.repeat(64),
  range: {
    start: { line: 1, column: 1 },
    end: { line: 1, column: 20 },
  },
};

function reportFixture(): AnalysisReport {
  return {
    schemaVersion: '2.2.0',
    reportId: 'report-12345678',
    generatedAt: '2026-07-28T12:00:00.000Z',
    provenance: {
      reportSchema: { id: 'analysis-report', version: '2.2.0' },
      analyzer: { name: 'Cisco Macro Analyzer', version: '2.2.0' },
      parser: { name: 'Acorn', version: '8.17.0' },
      rulePack: { id: 'test', version: '1.0.0' },
      credentialVocabulary: { id: 'macro-credential-vocabulary', version: '1.0.0' },
      recognizedMacroGlobals: { id: 'roomos-macro-globals', version: '1.0.0' },
      schemaSnapshot: {
        id: 'test',
        release: '26.7.1',
        sha256: 'schema',
        objectCount: 0,
        upstreamUpdatedAt: '2026-07-01T00:00:00.000Z',
      },
      declaredTarget: { kind: 'exploratory' },
    },
    target: { kind: 'exploratory' },
    fileInventory: [
      {
        fileId: 'main',
        path: 'main<&>.js',
        contentHash: 'a'.repeat(64),
        roles: ['Entry', 'Dependency'],
        activeState: 'Unknown',
        analysisState: 'Evaluated',
        affectedEntryMacroIds: ['main'],
      },
      {
        fileId: 'helper',
        path: 'helper.js',
        contentHash: 'b'.repeat(64),
        roles: ['Dependency'],
        activeState: 'Unknown',
        analysisState: 'Evaluated',
        affectedEntryMacroIds: ['main'],
      },
    ],
    observationLedger: [
      {
        id: 'obs-11111111',
        family: 'external-domains',
        kind: 'external-domain',
        domain: 'api.example.com',
        protocol: 'https',
        usage: 'xapi-parameter',
        sourceReference,
      },
      {
        id: 'obs-22222222',
        family: 'external-domains',
        kind: 'external-domain',
        domain: 'api.example.com',
        protocol: 'wss',
        usage: 'not-in-use',
        sourceReference: { ...sourceReference, fileId: 'helper' },
      },
    ],
    observationCoverage: [],
    directDependencyGraph: [
      { importerFileId: 'main', dependencyFileId: 'helper', observationId: 'obs-33333333' },
      { importerFileId: 'helper', dependencyFileId: 'main', observationId: 'obs-44444444' },
    ],
    unresolvedDependencyEdges: [{
      id: 'missing-1',
      virtualFileId: 'missing-file',
      normalizedExpectedPath: 'missing.js',
      importerFileIds: ['helper'],
      observationIds: ['obs-55555555'],
      affectedEntryMacroIds: ['main'],
      dependencyRoutes: [{ entryMacroId: 'main', fileIds: ['main', 'helper', 'missing-file'] }],
      state: 'Not evaluated',
    }],
    findings: [],
    findingImpacts: [],
    coverage: {
      files: { supplied: 2, reachable: 2, parsed: 2, failed: 0, notInAnalyzedGraph: 0 },
      imports: { localResolved: 2, localUnresolved: 1, dynamic: 0 },
      xapiReferences: { candidates: 0, staticallyResolved: 0, dynamic: 0, dynamicArguments: 0 },
      completeness: 'partial',
    },
    inventory: {
      references: [],
      counts: { Command: 0, Configuration: 0, Status: 0, Event: 0 },
    },
    limitations: ['Test fixture.'],
  };
}

describe('dependency map presentation', () => {
  it('keeps cycles, missing imports, and shared external domains in one rooted graph', () => {
    const model = buildDependencyMap(reportFixture(), 'main');

    expect(model.counts).toEqual({
      dependencies: 3,
      macros: 2,
      missing: 1,
      externalDomains: 1,
      externalDomainsInUse: 1,
      externalDomainsNotInUse: 1,
    });
    expect(model.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'file:main', kind: 'entry', depth: 0 }),
      expect.objectContaining({ id: 'file:helper', kind: 'macro', depth: 1 }),
      expect.objectContaining({ id: 'missing:missing-file', kind: 'missing' }),
      expect.objectContaining({
        id: 'external:api.example.com',
        detail: 'HTTPS/WSS · in use + not in use',
        externalStatus: 'mixed',
      }),
    ]));
    expect(model.edges).toEqual(expect.arrayContaining([
      { from: 'file:main', to: 'file:helper', kind: 'local-import' },
      { from: 'file:helper', to: 'file:main', kind: 'local-import' },
      { from: 'file:helper', to: 'missing:missing-file', kind: 'missing-import' },
      { from: 'file:main', to: 'external:api.example.com', kind: 'external-url' },
      { from: 'file:helper', to: 'external:api.example.com', kind: 'external-url' },
    ]));
  });

  it('reports zero dependencies for an entry with no relationships', () => {
    const report = reportFixture();
    report.fileInventory = [report.fileInventory[0]!];
    report.observationLedger = [];
    report.directDependencyGraph = [];
    report.unresolvedDependencyEdges = [];

    expect(buildDependencyMap(report, 'main').counts.dependencies).toBe(0);
  });

  it('places a shared dependency after the dependency that also imports it', () => {
    const report = reportFixture();
    report.fileInventory.push({
      fileId: 'telemetry',
      path: 'telemetry.js',
      contentHash: 'c'.repeat(64),
      roles: ['Dependency'],
      activeState: 'Unknown',
      analysisState: 'Evaluated',
      affectedEntryMacroIds: ['main'],
    });
    report.observationLedger = [];
    report.directDependencyGraph = [
      { importerFileId: 'main', dependencyFileId: 'helper', observationId: 'obs-33333333' },
      { importerFileId: 'main', dependencyFileId: 'telemetry', observationId: 'obs-44444444' },
      { importerFileId: 'helper', dependencyFileId: 'telemetry', observationId: 'obs-55555555' },
    ];
    report.unresolvedDependencyEdges = [];

    const model = buildDependencyMap(report, 'main');

    expect(model.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'file:main', depth: 0 }),
      expect.objectContaining({ id: 'file:helper', depth: 1 }),
      expect.objectContaining({ id: 'file:telemetry', depth: 2 }),
    ]));
    expect(renderDependencyMapSvg(model))
      .toContain('class="dependency-map-edge local-import skip-level"');
  });

  it('renders an escaped, accessible SVG without complete URL values', () => {
    const svg = renderDependencyMapSvg(buildDependencyMap(reportFixture(), 'main'));

    expect(svg).toContain('role="img"');
    expect(svg).toContain('main&lt;&amp;&gt;.js');
    expect(svg).toContain('api.example.com');
    expect(svg).not.toContain('https://');
    expect(svg).toContain('class="dependency-map-edge local-import cycle"');
  });
});
