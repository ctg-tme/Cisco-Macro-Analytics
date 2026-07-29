import { describe, expect, it } from 'vitest';
import type { AnalysisReport } from '../analysis/types';
import {
  buildDependencyMap,
  collectDependencyMapFocus,
  renderDependencyMapSvg,
  type DependencyMapModel,
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
    schemaVersion: '2.3.0',
    reportId: 'report-12345678',
    generatedAt: '2026-07-28T12:00:00.000Z',
    provenance: {
      reportSchema: { id: 'analysis-report', version: '2.3.0' },
      analyzer: { name: 'Cisco Macro Analyzer', version: '2.3.0' },
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
        family: 'external-destinations',
        kind: 'external-dependency',
        destination: 'api.example.com',
        protocol: 'https',
        usage: 'in-use',
        usageExplanation: {
          reason: 'xapi-argument',
          summary: 'The URL reaches xAPI.',
        },
        sourceReference,
      },
      {
        id: 'obs-22222222',
        family: 'external-destinations',
        kind: 'external-dependency',
        destination: 'api.example.com',
        protocol: 'wss',
        usage: 'not-in-use',
        usageExplanation: {
          reason: 'never-read',
          summary: 'The URL is never read.',
        },
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
      externalDestinations: 1,
      externalDestinationsInUse: 1,
      externalDestinationsUseUnknown: 0,
      externalDestinationsNotInUse: 0,
      dynamicUrls: 0,
      dynamicUrlsInUse: 0,
      dynamicUrlsUseUnknown: 0,
      commentedUrls: 0,
    });
    expect(model.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'file:main', kind: 'entry', depth: 0 }),
      expect.objectContaining({ id: 'file:helper', kind: 'macro', depth: 1 }),
      expect.objectContaining({ id: 'missing:missing-file', kind: 'missing' }),
      expect.objectContaining({
        id: 'external:api.example.com',
        detail: 'In Use · HTTPS/WSS · 2 occurrences',
        externalStatus: 'in-use',
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

  it('keeps commented URLs outside the default map and aggregates them per source Macro', () => {
    const report = reportFixture();
    report.observationLedger.push(
      {
        id: 'obs-aaaaaaaa',
        family: 'external-destinations',
        kind: 'commented-url',
        destination: 'comment.example.com:443',
        protocol: 'https',
        usage: 'not-in-use',
        usageExplanation: {
          reason: 'commented',
          summary: 'The URL occurs in a comment.',
        },
        sourceReference,
      },
      {
        id: 'obs-bbbbbbbb',
        family: 'external-destinations',
        kind: 'commented-url',
        destination: 'docs.example.com',
        protocol: 'https',
        usage: 'not-in-use',
        usageExplanation: {
          reason: 'commented',
          summary: 'The URL occurs in a comment.',
        },
        sourceReference: { ...sourceReference, fileId: 'helper' },
      },
      {
        id: 'obs-cccccccc',
        family: 'external-destinations',
        kind: 'commented-url',
        destination: 'support.example.com',
        protocol: 'https',
        usage: 'not-in-use',
        usageExplanation: {
          reason: 'commented',
          summary: 'The URL occurs in a comment.',
        },
        sourceReference: { ...sourceReference, fileId: 'helper' },
      },
    );

    const hidden = buildDependencyMap(report, 'main');
    const shown = buildDependencyMap(report, 'main', { showCommentedUrls: true });

    expect(hidden.nodes.some((node) => node.kind === 'commented-urls')).toBe(false);
    expect(hidden.counts.commentedUrls).toBe(3);
    expect(shown.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'commented-urls:main',
        label: 'Commented URLs · main<&>.js',
        externalStatus: 'not-in-use',
        observationIds: ['obs-aaaaaaaa'],
      }),
      expect.objectContaining({
        id: 'commented-urls:helper',
        label: 'Commented URLs · helper.js',
        detail: 'Not In Use · 2 occurrences',
        externalStatus: 'not-in-use',
        observationIds: ['obs-bbbbbbbb', 'obs-cccccccc'],
      }),
    ]));
    expect(shown.edges).toEqual(expect.arrayContaining([
      { from: 'file:main', to: 'commented-urls:main', kind: 'external-url' },
      { from: 'file:helper', to: 'commented-urls:helper', kind: 'external-url' },
    ]));
    expect(shown.counts.dependencies).toBe(hidden.counts.dependencies);
  });

  it('focuses the complete ancestor and descendant route without sibling branches', () => {
    const model: DependencyMapModel = {
      entryFileId: 'entry',
      nodes: [
        { id: 'entry', label: 'Entry', detail: 'Entry Macro', kind: 'entry', depth: 0 },
        { id: 'parent', label: 'Parent', detail: 'Macro', kind: 'macro', depth: 1 },
        { id: 'leaf', label: 'Leaf', detail: 'Use Unknown', kind: 'external', depth: 2 },
        { id: 'sibling', label: 'Sibling', detail: 'Missing dependency', kind: 'missing', depth: 1 },
      ],
      edges: [
        { from: 'entry', to: 'parent', kind: 'local-import' },
        { from: 'parent', to: 'leaf', kind: 'external-url' },
        { from: 'entry', to: 'sibling', kind: 'missing-import' },
      ],
      counts: {
        dependencies: 3,
        macros: 2,
        missing: 1,
        externalDestinations: 1,
        externalDestinationsInUse: 0,
        externalDestinationsUseUnknown: 1,
        externalDestinationsNotInUse: 0,
        dynamicUrls: 0,
        dynamicUrlsInUse: 0,
        dynamicUrlsUseUnknown: 0,
        commentedUrls: 0,
      },
    };

    expect(collectDependencyMapFocus(model, 'entry').nodeIds).toEqual([
      'entry',
      'leaf',
      'parent',
      'sibling',
    ]);
    expect(collectDependencyMapFocus(model, 'leaf')).toEqual({
      nodeIds: ['entry', 'leaf', 'parent'],
      edgeIds: [
        '["entry","parent","local-import"]',
        '["parent","leaf","external-url"]',
      ],
    });
    expect(collectDependencyMapFocus(model, 'parent').nodeIds).toEqual([
      'entry',
      'leaf',
      'parent',
    ]);
  });

  it('uses In Use, Use Unknown, Not In Use priority for destination aggregation', () => {
    const report = reportFixture();
    const observations = report.observationLedger.filter((observation) =>
      observation.kind === 'external-dependency');
    if (observations[0]?.kind !== 'external-dependency'
      || observations[1]?.kind !== 'external-dependency') {
      throw new Error('Expected external dependency fixtures.');
    }
    observations[0].usage = 'use-unknown';
    observations[0].usageExplanation = {
      reason: 'opaque-flow',
      summary: 'The URL reaches an opaque boundary.',
    };

    expect(buildDependencyMap(report, 'main').nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'external:api.example.com',
        externalStatus: 'use-unknown',
      }),
    ]));

    observations[1].usage = 'in-use';
    observations[1].usageExplanation = {
      reason: 'xml-payload',
      summary: 'The URL occurs in executable XML.',
    };
    expect(buildDependencyMap(report, 'main').nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'external:api.example.com',
        externalStatus: 'in-use',
      }),
    ]));
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

  it('staggers same-level nodes and fans sibling routes out from distinct ports', () => {
    const model: DependencyMapModel = {
      entryFileId: 'entry',
      nodes: [
        { id: 'entry', label: 'Entry', detail: 'Entry Macro', kind: 'entry', depth: 0 },
        { id: 'child-a', label: 'First import', detail: 'Macro', kind: 'macro', depth: 1 },
        { id: 'child-b', label: 'Second import', detail: 'Macro', kind: 'macro', depth: 1 },
      ],
      edges: [
        { from: 'entry', to: 'child-a', kind: 'local-import' },
        { from: 'entry', to: 'child-b', kind: 'local-import' },
      ],
      counts: {
        dependencies: 2,
        macros: 3,
        missing: 0,
        externalDestinations: 0,
        externalDestinationsInUse: 0,
        externalDestinationsUseUnknown: 0,
        externalDestinationsNotInUse: 0,
        dynamicUrls: 0,
        dynamicUrlsInUse: 0,
        dynamicUrlsUseUnknown: 0,
        commentedUrls: 0,
      },
    };

    const svg = renderDependencyMapSvg(model);
    const position = (nodeId: string): [number, number] => {
      const match = svg.match(new RegExp(
        `transform="translate\\((\\d+(?:\\.\\d+)?) (\\d+(?:\\.\\d+)?)\\)" data-dependency-node-id="${nodeId}"`,
      ));
      if (!match) throw new Error(`Missing position for ${nodeId}`);
      return [Number(match[1]), Number(match[2])];
    };
    const routeStart = (targetId: string): [number, number] => {
      const match = svg.match(new RegExp(
        `data-dependency-edge-from="entry" data-dependency-edge-to="${targetId}"[^>]+d="M (\\d+(?:\\.\\d+)?) (\\d+(?:\\.\\d+)?)`,
      ));
      if (!match) throw new Error(`Missing route to ${targetId}`);
      return [Number(match[1]), Number(match[2])];
    };

    const firstPosition = position('child-a');
    const secondPosition = position('child-b');
    expect(firstPosition[0]).toBeLessThan(secondPosition[0]);
    expect(firstPosition[1]).toBeLessThan(secondPosition[1]);
    expect(routeStart('child-a')[1]).not.toBe(routeStart('child-b')[1]);
  });

  it('renders an escaped, accessible SVG without complete URL values', () => {
    const svg = renderDependencyMapSvg(buildDependencyMap(reportFixture(), 'main'));

    expect(svg).toContain('role="img"');
    expect(svg).toContain('main&lt;&amp;&gt;.js');
    expect(svg).toContain('api.example.com');
    expect(svg).not.toContain('https://');
    expect(svg).toContain('class="dependency-map-edge local-import cycle"');
    expect(svg.match(/class="dependency-map-beta-ribbon"/g)).toHaveLength(1);
    expect(svg).toContain('URL dependency classification is beta');
  });

  it('wraps complete node names and exposes connection endpoints for focused routes', () => {
    const report = reportFixture();
    report.fileInventory[0]!.path = 'Custom-Campanion_1_Main_2026.js';

    const svg = renderDependencyMapSvg(buildDependencyMap(report, 'main'));

    expect(svg).toContain('dependency-map-node-label-line');
    expect(svg).toContain('Custom-Campanion_1_Main_');
    expect(svg).toContain('2026.js');
    expect(svg).not.toContain('…');
    expect(svg).toContain('data-dependency-node-id="file:main"');
    expect(svg).toContain('data-dependency-edge-from="file:main"');
    expect(svg).toContain('data-dependency-edge-to="file:helper"');
    expect(svg).toMatch(/class="dependency-map-edge missing-import"[^>]+d="[^"]+Q[^"]+V[^"]+Q/);
    expect(
      svg.match(/class="dependency-map-edge local-import"[^>]+d="([^"]+)"/)?.[1],
    ).not.toContain('Q');
  });
});
