import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import { analyzeMacroSet } from './analyzeMacroSet';
import { sha256 } from './internal/reportSupport';
import reportSchema from './report.schema.json';
import type { AnalysisInput, MacroFile, SchemaSnapshot } from './types';

const schemaSnapshot: SchemaSnapshot = {
  id: 'roomos-test',
  release: '26.7.1',
  sha256: 'schema-fixture',
  upstreamUpdatedAt: '2026-07-01T00:00:00.000Z',
  objectCount: 3,
  objects: [
    {
      type: 'Status',
      path: 'Audio Volume',
      products: ['room_bar'],
      attributes: { role: ['Admin', 'Integrator', 'User'] },
    },
    {
      type: 'Command',
      path: 'Audio Volume Set',
      products: ['room_bar'],
      attributes: {
        role: ['Admin', 'Integrator'],
        params: [{ name: 'Level', required: true, minimum: 0, maximum: 100 }],
      },
    },
    {
      type: 'Event',
      path: 'CallDisconnect',
      products: ['room_bar'],
      attributes: { role: ['Admin', 'Integrator', 'User'] },
    },
  ],
};

function analyze(files: MacroFile[], entryMacroIds?: string[]) {
  const input: AnalysisInput = {
    macroSet: { files, ...(entryMacroIds ? { entryMacroIds } : {}) },
    target: {
      kind: 'declared',
      release: '26.7.1',
      productModel: 'room_bar',
      operatingMode: 'Native',
      runtimeRole: 'Integrator',
    },
    schemaSnapshot,
    rulePack: { id: 'roomos-macro-rules', version: '2.0.0', rules: [] },
    analysisTime: '2026-07-28T12:00:00.000Z',
  };
  const outcome = analyzeMacroSet(input);
  if (outcome.kind !== 'report') throw new Error(outcome.failure.message);
  return outcome.report;
}

describe('Analysis Report 2.3.0', () => {
  it('produces standard deterministic SHA-256 file fingerprints', () => {
    expect(sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('validates the separated report layers and report-safe source references', () => {
    const report = analyze([{
      id: 'main',
      path: 'main.js',
      source: "import xapi from 'xapi';\nxapi.Status.Audio.Volume.get();",
    }], ['main']);
    const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(reportSchema);

    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
    expect(report.schemaVersion).toBe('2.3.0');
    expect(report.fileInventory).toHaveLength(1);
    expect(report.observationLedger.some((observation) => observation.kind === 'xapi-touchpoint')).toBe(true);
    expect(report.observationCoverage[0]?.families).toHaveLength(8);
    expect(report.provenance).toEqual(expect.objectContaining({
      reportSchema: { id: 'analysis-report', version: '2.3.0' },
      parser: { name: 'Acorn', version: expect.any(String) },
      credentialVocabulary: expect.objectContaining({ version: expect.any(String) }),
      recognizedMacroGlobals: expect.objectContaining({ version: expect.any(String) }),
      declaredTarget: expect.objectContaining({ kind: 'declared' }),
    }));
    const touchpoint = report.observationLedger.find((observation) =>
      observation.kind === 'xapi-touchpoint');
    expect(touchpoint?.sourceReference).toEqual({
      fileId: 'main',
      fileContentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      range: expect.any(Object),
    });
  });

  it('validates Observed, Potential Risk, Unknown, and Coverage Gap outcomes together', () => {
    const report = analyze([{
      id: 'main',
      path: 'main.js',
      source: [
        "const xapi = require('xapi');",
        'xapi.Command.Audio.Volume.Set({ Level: 120 });',
        'xapi.Status[missingSection].Volume.get();',
      ].join('\n'),
    }], ['main']);
    const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(reportSchema);

    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'source.commonjs-migration',
        evidence: 'observed-finding',
        priority: 'required',
      }),
      expect.objectContaining({
        code: 'schema.literal-out-of-range',
        evidence: 'potential-risk',
        priority: 'required',
      }),
      expect.objectContaining({
        code: 'coverage.xapi-flow-frontier',
        evidence: 'unknown',
        priority: 'advisory',
      }),
    ]));
    expect(report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'source.unresolved-identifier' }),
    ]));
    expect(report.findings.every((finding) =>
      finding.rule.evidenceRequirements.length > 0
      && finding.observationIds.length > 0
      && finding.affectedEntryMacroIds.length > 0
      && finding.limitations.length > 0)).toBe(true);
  });

  it('seeds only from proven xapi module origins and follows call-site-specific aliases', () => {
    const report = analyze([{
      id: 'main',
      path: 'main.js',
      source: [
        "import roomApi from 'xapi';",
        'function readVolume(client) { return client.Status.Audio.Volume.get(); }',
        'readVolume(roomApi);',
        'readVolume({ Status: { Audio: { Volume: { get() {} } } } });',
        'const lookalike = { Status: { Audio: { Volume: { get() {} } } } };',
        'lookalike.Status.Audio.Volume.get();',
      ].join('\n'),
    }], ['main']);
    const touchpoints = report.observationLedger.filter((observation) =>
      observation.kind === 'xapi-touchpoint');

    expect(touchpoints).toHaveLength(1);
    expect(touchpoints[0]).toEqual(expect.objectContaining({
      canonicalReference: expect.objectContaining({
        kind: 'Status',
        normalizedPathSegments: ['Audio', 'Volume'],
        operation: 'get',
        preferredNewStyleExpression: 'xapi.Status.Audio.Volume.get()',
      }),
      bindingRoutes: [
        expect.objectContaining({
          hops: expect.arrayContaining([
            expect.objectContaining({ bindingName: 'roomApi', transformation: 'module-origin' }),
            expect.objectContaining({ bindingName: 'client', transformation: 'argument-to-parameter' }),
          ]),
        }),
      ],
    }));
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'source.nonstandard-xapi-root', priority: 'warning' }),
      expect.objectContaining({ code: 'source.xapi-abstraction', priority: 'informational' }),
    ]));
  });

  it('respects assignment order and leaves a mixed post-branch use at a flow frontier', () => {
    const report = analyze([{
      id: 'main',
      path: 'main.js',
      source: [
        "import xapi from 'xapi';",
        'let api = xapi;',
        'api.Status.Audio.Volume.get();',
        'if (condition) api = {};',
        'api.Status.Audio.Volume.get();',
      ].join('\n'),
    }], ['main']);
    const touchpoints = report.observationLedger.filter((observation) =>
      observation.kind === 'xapi-touchpoint');
    const frontiers = report.observationLedger.filter((observation) =>
      observation.kind === 'xapi-flow-frontier');

    expect(touchpoints).toHaveLength(1);
    expect(touchpoints[0]?.sourceReference.range.start.line).toBe(3);
    expect(frontiers).toEqual([
      expect.objectContaining({ frontierType: 'mixed-flow' }),
    ]);
    expect(report.observationCoverage[0]?.families).toEqual(expect.arrayContaining([
      { family: 'xapi-touchpoints', state: 'Partial', reason: expect.any(String) },
    ]));
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'coverage.xapi-flow-frontier', priority: 'advisory' }),
    ]));
    expect(report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'source.unresolved-identifier' }),
    ]));
  });

  it('follows returns, constructor parameters, instance properties, methods, and dependency crossings', () => {
    const report = analyze([
      {
        id: 'main',
        path: 'main.js',
        source: [
          "import xapi from 'xapi';",
          "import { Adapter, identity } from './adapter.js';",
          'const adapter = new Adapter(identity(xapi));',
          'adapter.read();',
        ].join('\n'),
      },
      {
        id: 'adapter',
        path: 'adapter.js',
        source: [
          'export function identity(value) { return value; }',
          'export class Adapter {',
          '  constructor(client) { this.client = client; }',
          '  read() { return this.client.Status.Audio.Volume.get(); }',
          '}',
        ].join('\n'),
      },
    ], ['main']);
    const touchpoint = report.observationLedger.find((observation) =>
      observation.kind === 'xapi-touchpoint');

    expect(touchpoint).toEqual(expect.objectContaining({
      sourceReference: expect.objectContaining({ fileId: 'adapter' }),
      bindingRoutes: [
        expect.objectContaining({
          hops: expect.arrayContaining([
            expect.objectContaining({ transformation: 'return' }),
            expect.objectContaining({ transformation: 'constructor-argument-to-parameter' }),
            expect.objectContaining({ transformation: 'instance-property' }),
          ]),
        }),
      ],
    }));
    expect(report.findingImpacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceFileId: 'adapter',
        entryMacroId: 'main',
        impact: 'dependency',
        dependencyPath: ['main', 'adapter'],
      }),
    ]));
  });

  it('follows a resolved xapi re-export across supplied files', () => {
    const report = analyze([
      {
        id: 'main',
        path: 'main.js',
        source: "import api from './bridge.js';\napi.Status.Audio.Volume.get();",
      },
      {
        id: 'bridge',
        path: 'bridge.js',
        source: "export { default } from 'xapi';",
      },
    ], ['main']);
    const touchpoint = report.observationLedger.find((observation) =>
      observation.kind === 'xapi-touchpoint');

    expect(touchpoint).toEqual(expect.objectContaining({
      canonicalReference: expect.objectContaining({
        kind: 'Status',
        normalizedPathSegments: ['Audio', 'Volume'],
        operation: 'get',
      }),
      bindingRoutes: [
        expect.objectContaining({
          hops: expect.arrayContaining([
            expect.objectContaining({ transformation: 're-export' }),
            expect.objectContaining({
              transformation: 'import',
              dependencyCrossing: { fromFileId: 'bridge', toFileId: 'main' },
            }),
          ]),
        }),
      ],
    }));
  });

  it('defaults top-level cycles to Entry while preserving their Dependency roles', () => {
    const report = analyze([
      {
        id: 'a',
        path: 'a.js',
        source: "import './b.js';\nexport const a = true;",
        active: false,
      },
      {
        id: 'b',
        path: 'b.js',
        source: "import './a.js';\nexport const b = true;",
        active: true,
      },
      {
        id: 'unused',
        path: 'unused.js',
        source: 'export const unused = true;',
      },
    ]);

    expect(report.fileInventory).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileId: 'a', roles: ['Entry', 'Dependency'], activeState: 'Inactive' }),
      expect.objectContaining({ fileId: 'b', roles: ['Entry', 'Dependency'], activeState: 'Active' }),
      expect.objectContaining({ fileId: 'unused', roles: ['Entry'], activeState: 'Unknown' }),
    ]));
    expect(report.directDependencyGraph).toHaveLength(2);
    expect(report.observationCoverage.find((coverage) => coverage.fileId === 'unused')?.families)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          family: 'xapi-touchpoints',
          state: 'Complete',
        }),
      ]));
  });

  it('consolidates missing dependencies and retains importers, entries, and routes', () => {
    const report = analyze([
      {
        id: 'first',
        path: 'first.js',
        source: "import './shared/missing';",
      },
      {
        id: 'second',
        path: 'second.js',
        source: "import './shared/missing.js';",
      },
    ], ['first', 'second']);

    expect(report.unresolvedDependencyEdges).toEqual([
      expect.objectContaining({
        normalizedExpectedPath: 'shared/missing.js',
        importerFileIds: ['first', 'second'],
        affectedEntryMacroIds: ['first', 'second'],
        dependencyRoutes: expect.arrayContaining([
          expect.objectContaining({ entryMacroId: 'first' }),
          expect.objectContaining({ entryMacroId: 'second' }),
        ]),
        state: 'Not evaluated',
      }),
    ]);
    expect(report.findings.filter((finding) => finding.code === 'coverage.missing-dependency')).toHaveLength(1);
    const missingFinding = report.findings.find((finding) =>
      finding.code === 'coverage.missing-dependency');
    expect(report.findingImpacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        findingId: missingFinding?.id,
        impact: 'dependency',
        entryMacroId: 'first',
        dependencyPath: ['first', expect.stringMatching(/^missing-/)],
      }),
    ]));
  });

  it('retains static external domains without retaining complete URL paths', () => {
    const report = analyze([{
      id: 'main',
      path: 'main.js',
      source: [
        "import xapi from 'xapi';",
        "const api = 'https://API.Example.COM/v1/token?key=private';",
        'function request(client, url) { client.Command.HttpClient.Get({ Url: url }); }',
        'request(xapi, api);',
        'const socket = `wss://stream.example.com/rooms/${roomId}`;',
        "const payload = '<?xml version=\"1.0\"?><Extensions><Icon>https://assets.example.com/icon.png</Icon></Extensions>';",
        "const savedPayload = '<Panel><Url>https://panel.example.com/view</Url></Panel>';",
        'xapi.Command.UserInterface.Extensions.Panel.Save({ Body: savedPayload });',
        "const interpolatedUrl = 'https://template.example.com/item';",
        'const interpolatedPayload = `<Config><Url>${interpolatedUrl}</Url></Config>`;',
        'const dynamicHost = `https://${tenant}.example.com/v1`;',
        'xapi.Config.HttpClient.Mode.set(dynamicHost);',
        "const note = 'Read http://docs.example.com/setup.';",
        "xapi.Command.HttpClient.Get({ Url: 'ftp://files.example.com/firmware/latest.bin' });",
        '// https://comment.example.com/ignored',
      ].join('\n'),
    }], ['main']);
    const domains = report.observationLedger.filter((observation) =>
      observation.kind === 'external-dependency');
    const serialized = JSON.stringify(report);
    const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(reportSchema);

    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
    expect(domains).toEqual([
      expect.objectContaining({
        destination: 'api.example.com',
        protocol: 'https',
        usage: 'in-use',
      }),
      expect.objectContaining({
        destination: 'stream.example.com',
        protocol: 'wss',
        usage: 'not-in-use',
      }),
      expect.objectContaining({
        destination: 'assets.example.com',
        protocol: 'https',
        usage: 'in-use',
      }),
      expect.objectContaining({
        destination: 'panel.example.com',
        protocol: 'https',
        usage: 'in-use',
      }),
      expect.objectContaining({
        destination: 'template.example.com',
        protocol: 'https',
        usage: 'in-use',
      }),
      expect.objectContaining({
        destination: 'docs.example.com',
        protocol: 'http',
        usage: 'not-in-use',
      }),
      expect.objectContaining({
        destination: 'files.example.com',
        protocol: 'ftp',
        usage: 'in-use',
      }),
    ]);
    expect(report.observationCoverage[0]?.families).toEqual(expect.arrayContaining([
      {
        family: 'external-destinations',
        state: 'Partial',
        reason: 'At least one URL determines its external destination at runtime.',
      },
    ]));
    expect(report.observationLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'dynamic-url',
        protocol: 'https',
        usage: 'use-unknown',
      }),
      expect.objectContaining({
        kind: 'commented-url',
        destination: 'comment.example.com',
        usage: 'not-in-use',
      }),
    ]));
    expect(serialized).not.toContain('/v1/token');
    expect(serialized).not.toContain('/rooms/');
    expect(serialized).not.toContain('/icon.png');
    expect(serialized).not.toContain('/view');
    expect(serialized).not.toContain('/item');
    expect(serialized).not.toContain('/setup');
    expect(serialized).not.toContain('/firmware/');
    expect(serialized).toContain('comment.example.com');
    expect(serialized).not.toContain('/ignored');
  });

  it('classifies a URL imported into an xAPI argument as in use', () => {
    const report = analyze([
      {
        id: 'main',
        path: 'main.js',
        source: [
          "import xapi from 'xapi';",
          "import { endpoint } from './endpoint.js';",
          'xapi.Command.HttpClient.Get({ Url: endpoint });',
        ].join('\n'),
      },
      {
        id: 'endpoint',
        path: 'endpoint.js',
        source: "export const endpoint = 'https://imported.example.com/v1/private';",
      },
    ], ['main']);

    expect(report.observationLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'external-dependency',
        destination: 'imported.example.com',
        usage: 'in-use',
        sourceReference: expect.objectContaining({ fileId: 'endpoint' }),
      }),
    ]));
    expect(JSON.stringify(report)).not.toContain('/v1/private');
  });

  it('preserves URL origins through conservative string normalization helpers', () => {
    const report = analyze([{
      id: 'main',
      path: 'main.js',
      source: [
        "import xapi from 'xapi';",
        "const iconUrl = 'https://ctg-tme.github.io/icons/custom-companion.png';",
        'function download(client, url) {',
        "  const normalizedUrl = String(url || '').trim();",
        '  return request(client, normalizedUrl);',
        '}',
        'function request(client, url) {',
        '  return client.Command.UserInterface.Extensions.Icon.Download({ Url: url });',
        '}',
        'download(xapi, iconUrl);',
      ].join('\n'),
    }], ['main']);

    expect(report.observationLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'external-dependency',
        destination: 'ctg-tme.github.io',
        usage: 'in-use',
      }),
    ]));
  });

  it('proves URL use through map, destructuring, object reconstruction, serialization, and callback xAPI calls', () => {
    const report = analyze([{
      id: 'bookings',
      path: 'bookings.js',
      source: [
        "import xapi from 'xapi';",
        'const bookingTypes = [',
        '  { MeetingPlatform: "Webex", Title: "Webex Meeting", Number: "alynch@tmedemo.webex.com" },',
        '  { MeetingPlatform: "MicrosoftTeams", Title: "MicrosoftTeams Meeting", Number: "somenumber@example.com" },',
        '  { MeetingPlatform: "GoogleMeet", Title: "Google Meeting", Number: "https://meet.google.com/wti-npzq-yxd" }',
        '];',
        'const duration = 540;',
        'const bookings = function () {',
        '  return bookingTypes.map(({ MeetingPlatform, Title, Number }, i) => {',
        '    const Protocol = MeetingPlatform == "MicrosoftTeams" ? "SIP" : MeetingPlatform == "GoogleMeet" ? "WebRTC" : "Spark";',
        '    return {',
        '      Id: (i + 1).toString(),',
        '      MeetingId: "MyMeeting-" + (i + 1),',
        '      MeetingPlatform, Title, Number, Protocol,',
        '      Organizer: { Name: "Bobby" },',
        '      Time: { Duration: duration, EndTimeBuffer: 5, StartTime: addMinutes(new Date(), 15 * i).toJSON() }',
        '    };',
        '  });',
        '};',
        'function addMinutes(date, minutes) { date.setMinutes(date.getMinutes() + minutes); return date; }',
        'const Bookings = { Bookings: bookings() };',
        "console.log('Saving Bookings:', JSON.stringify(Bookings));",
        'setTimeout(() => {',
        '  xapi.Command.Bookings.Put({}, JSON.stringify(Bookings));',
        '}, 5000);',
        "xapi.Event.UserInterface.Extensions.Panel.Clicked.on(event => {",
        "  if (event.PanelId == 'resetBookings') {",
        '    xapi.Command.Bookings.Put({}, JSON.stringify({ Bookings: bookings() }));',
        '  }',
        '});',
      ].join('\n'),
    }], ['bookings']);

    const observation = report.observationLedger.find((candidate) =>
      candidate.kind === 'external-dependency'
      && candidate.destination === 'meet.google.com');
    expect(observation).toEqual(expect.objectContaining({
      kind: 'external-dependency',
      destination: 'meet.google.com',
      protocol: 'https',
      usage: 'in-use',
      usageExplanation: expect.objectContaining({
        reason: 'xapi-argument',
        provenanceRoutes: expect.any(Array),
      }),
      sourceReference: expect.objectContaining({
        fileId: 'bookings',
        range: expect.objectContaining({
          start: expect.objectContaining({ line: 5 }),
        }),
      }),
    }));
    if (observation?.kind !== 'external-dependency') {
      throw new Error('Expected the booking URL observation.');
    }
    const transformations = new Set(
      observation.usageExplanation.provenanceRoutes
        ?.flatMap((route) => route.hops.map((hop) => hop.transformation)),
    );
    expect(transformations).toEqual(expect.objectContaining(new Set([
      'literal',
      'array-element',
      'destructure',
      'object-property',
      'array-map',
      'json-stringify',
      'xapi-argument',
    ])));
    expect(observation.usageExplanation.summary).not.toMatch(/executed|network access/i);
  });

  it('distinguishes proven non-use from opaque URL escape and explains each state', () => {
    const report = analyze([{
      id: 'main',
      path: 'main.js',
      source: [
        "const unused = { url: 'https://unused.example.com:8443/path' };",
        "const logged = 'https://logged.example.com/path';",
        'console.log(logged);',
        "const escaped = 'https://unknown.example.com/path';",
        'sendToUnknownLibrary(escaped);',
        "export const published = 'https://exported.example.com/path';",
      ].join('\n'),
    }], ['main']);

    expect(report.observationLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'external-dependency',
        destination: 'unused.example.com:8443',
        usage: 'not-in-use',
        usageExplanation: expect.objectContaining({ reason: 'never-read' }),
      }),
      expect.objectContaining({
        kind: 'external-dependency',
        destination: 'logged.example.com',
        usage: 'not-in-use',
        usageExplanation: expect.objectContaining({ reason: 'logging-only' }),
      }),
      expect.objectContaining({
        kind: 'external-dependency',
        destination: 'unknown.example.com',
        usage: 'use-unknown',
        usageExplanation: expect.objectContaining({ reason: 'opaque-flow' }),
      }),
      expect.objectContaining({
        kind: 'external-dependency',
        destination: 'exported.example.com',
        usage: 'use-unknown',
        usageExplanation: expect.objectContaining({ reason: 'opaque-flow' }),
      }),
    ]));
  });

  it('keeps authored ports in External Destination identity, including default and IP ports', () => {
    const report = analyze([{
      id: 'ports',
      path: 'ports.js',
      source: [
        "const a = 'https://example.com/path';",
        "const b = 'https://example.com:443/path';",
        "const c = 'http://192.0.2.10:8080/status';",
        "const d = 'https://[2001:db8::10]:9443/status';",
      ].join('\n'),
    }], ['ports']);
    const destinations = report.observationLedger.flatMap((observation) =>
      observation.kind === 'external-dependency' ? [observation.destination] : []);

    expect(destinations).toEqual([
      'example.com',
      'example.com:443',
      '192.0.2.10:8080',
      '[2001:db8::10]:9443',
    ]);
  });

  it('retains unresolved identifiers as neutral observations without attaching them to a flow-frontier Finding', () => {
    const report = analyze([{
      id: 'main',
      path: 'main.js',
      source: [
        "import xapi from 'xapi';",
        'sendSomewhere(xapi);',
        'if (maybeEnabled) console.log(anotherMissing);',
      ].join('\n'),
    }], ['main']);
    const unresolved = report.observationLedger.filter((observation) =>
      observation.kind === 'unresolved-identifier');
    const frontier = report.findings.find((finding) =>
      finding.code === 'coverage.xapi-flow-frontier');

    expect(unresolved).toEqual(expect.arrayContaining([
      expect.objectContaining({ identifier: 'anotherMissing' }),
      expect.objectContaining({ identifier: 'maybeEnabled' }),
      expect.objectContaining({ identifier: 'sendSomewhere' }),
    ]));
    expect(frontier).toBeDefined();
    expect(report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'source.unresolved-identifier' }),
    ]));
    expect(unresolved.some((observation) => frontier?.observationIds.includes(observation.id))).toBe(false);
  });

  it('retains Argument Shape without literal values or dynamic identifier text', () => {
    const source = [
      "import xapi from 'xapi';",
      "const password = 'do-not-export-this-secret';",
      'const runtimeArgsUnique = { Level: 73 };',
      'xapi.Command.Audio.Volume.Set(runtimeArgsUnique);',
    ].join('\n');
    const report = analyze([{ id: 'main', path: 'password-macro.js', source }], ['main']);
    const serialized = JSON.stringify(report);
    const touchpoint = report.observationLedger.find((observation) =>
      observation.kind === 'xapi-touchpoint');

    expect(touchpoint).toEqual(expect.objectContaining({
      argumentShape: {
        argumentCount: 1,
        positions: [
          expect.objectContaining({
            position: 0,
            containerForm: 'binding',
            detectableValueType: 'unknown',
            valueForm: 'dynamic',
          }),
        ],
      },
    }));
    expect(serialized).not.toContain('do-not-export-this-secret');
    expect(serialized).not.toContain('runtimeArgsUnique');
    expect(serialized).not.toContain('"value":73');
  });

  it('retains neutral binding observations without inventing a Finding', () => {
    const report = analyze([{
      id: 'main',
      path: 'main.js',
      source: "import xapi from 'xapi';\nconst volume = xapi.Status.Audio.Volume;",
    }], ['main']);

    expect(report.findings).toEqual([]);
    expect(report.observationLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'xapi-root-binding', bindingName: 'xapi' }),
      expect.objectContaining({ kind: 'xapi-binding-flow', bindingName: 'volume' }),
    ]));
    expect(report.observationCoverage[0]?.families).toEqual(
      expect.arrayContaining([
        { family: 'xapi-bindings', state: 'Complete' },
        { family: 'xapi-touchpoints', state: 'Complete' },
      ]),
    );
  });

  it('covers every CommonJS form, ignores comments, and follows a destructured xapi require', () => {
    const report = analyze([{
      id: 'main',
      path: 'main.js',
      source: [
        "const { Status: statusBranch } = require('xapi');",
        'module.customMetadata = true;',
        'exports.ready = true;',
        'console.log(__filename, __dirname);',
        'statusBranch.Audio.Volume.get();',
        '// require(), module.exports, exports.foo, __filename, and __dirname are only discussed here',
      ].join('\n'),
    }], ['main']);
    const commonJs = report.observationLedger.filter((observation) =>
      observation.kind === 'commonjs-syntax');

    expect(commonJs.map((observation) =>
      observation.kind === 'commonjs-syntax' ? observation.form : '')).toEqual([
      'require',
      'module-member',
      'exports-member',
      '__filename',
      '__dirname',
    ]);
    expect(report.findings.filter((finding) =>
      finding.code === 'source.commonjs-migration')).toEqual([
      expect.objectContaining({
        priority: 'required',
        observationIds: commonJs.map((observation) => observation.id).sort(),
      }),
    ]);
    expect(report.inventory.references).toEqual([
      expect.objectContaining({ kind: 'Status', path: 'Audio Volume', operation: 'get' }),
    ]);
  });

  it('matches credential word components while rejecting arbitrary substrings', () => {
    const report = analyze([{
      id: 'main',
      path: 'service-account.js',
      source: [
        "const apiToken = 'do-not-retain';",
        'const tokenizer = makeTokenizer();',
        'const proxyAuthorization = apiToken;',
        'const setCookie = apiToken;',
        "const headers = { 'X-API-Key': apiToken };",
        '// user name example-person',
      ].join('\n'),
    }], ['main']);
    const indicators = report.observationLedger.filter((observation) =>
      observation.kind === 'credential-indicator');
    const serialized = JSON.stringify(report);

    expect(indicators).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalTerm: 'token', submittedTerm: 'Token' }),
      expect.objectContaining({ canonicalTerm: 'proxy authorization' }),
      expect.objectContaining({ canonicalTerm: 'set cookie' }),
      expect.objectContaining({ canonicalTerm: 'api key' }),
      expect.objectContaining({ canonicalTerm: 'user name' }),
      expect.objectContaining({ canonicalTerm: 'service account', location: 'filename' }),
    ]));
    expect(indicators.some((observation) =>
      observation.kind === 'credential-indicator'
      && observation.submittedTerm.toLowerCase() === 'tokenizer')).toBe(false);
    expect(report.findings.filter((finding) =>
      finding.code === 'source.sensitive-credential-indicator')).toHaveLength(1);
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'source.sensitive-credential-indicator',
        title: 'Authentication-related vocabulary detected',
        summary: expect.stringContaining('review vocabulary'),
      }),
    ]));
    expect(serialized).not.toContain('do-not-retain');
    expect(serialized).not.toContain('example-person');
  });

  it('consolidates repeated direct, abstracted, and old-style references independent of arguments', () => {
    const report = analyze([{
      id: 'main',
      path: 'main.js',
      source: [
        "import xapi from 'xapi';",
        'xapi.Command.Audio.Volume.Set({ Level: 10 });',
        'const setVolume = xapi.Command.Audio.Volume.Set;',
        'setVolume({ Level: 20 });',
        "xapi.command('Audio Volume Set', { Level: 30 });",
        'xapi.Status.Audio.Volume.get();',
        'xapi.Status.Audio.Volume.on(() => {});',
      ].join('\n'),
    }], ['main']);
    const repeated = report.findings.filter((finding) =>
      finding.code === 'source.repeated-xapi-reference');

    expect(repeated).toHaveLength(1);
    expect(repeated[0]).toEqual(expect.objectContaining({
      priority: 'advisory',
      observationIds: expect.arrayContaining([
        expect.any(String),
        expect.any(String),
        expect.any(String),
      ]),
      relatedXapiReference: expect.objectContaining({
        kind: 'Command',
        normalizedPathSegments: ['Audio', 'Volume', 'Set'],
        operation: 'execute',
      }),
    }));
    expect(repeated[0]?.observationIds).toHaveLength(3);
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'source.xapi-abstraction', priority: 'informational' }),
      expect.objectContaining({ code: 'source.mixed-xapi-syntax', priority: 'advisory' }),
    ]));
    expect(report.findings.filter((finding) =>
      finding.code === 'source.repeated-xapi-reference'
      && finding.relatedXapiReference?.operation !== 'execute')).toEqual([]);
  });

  it('distinguishes duplicate subscription registrations from other repeated references', () => {
    const report = analyze([{
      id: 'main',
      path: 'main.js',
      source: [
        "import xapi from 'xapi';",
        'xapi.Status.Audio.Volume.on(() => {});',
        'xapi.Status.Audio.Volume.on(() => {});',
      ].join('\n'),
    }], ['main']);

    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'source.duplicate-subscription',
        priority: 'advisory',
        observationIds: expect.any(Array),
        relatedXapiReference: expect.objectContaining({
          kind: 'Status',
          normalizedPathSegments: ['Audio', 'Volume'],
          operation: 'subscribe',
        }),
      }),
    ]));
    expect(report.findings.some((finding) =>
      finding.code === 'source.repeated-xapi-reference'
      && finding.relatedXapiReference?.operation === 'subscribe')).toBe(false);
  });

  it('detects duplicate subscriptions registered in separate macro files', () => {
    const report = analyze([
      {
        id: 'first',
        path: 'first.js',
        source: "import xapi from 'xapi';\nxapi.Status.Audio.Volume.on(() => {});",
      },
      {
        id: 'second',
        path: 'second.js',
        source: "import xapi from 'xapi';\nxapi.Status.Audio.Volume.on(() => {});",
      },
    ]);

    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'source.duplicate-subscription',
        sourceFileIds: ['first', 'second'],
        details: expect.objectContaining({
          registrationCount: 2,
          sourceFileIds: ['first', 'second'],
        }),
      }),
    ]));
  });

  it('separates linked overlap from overlap across independent macro graphs', () => {
    const report = analyze([
      {
        id: 'main',
        path: 'main.js',
        source: [
          "import xapi from 'xapi';",
          "import './middle.js';",
          'xapi.Status.Audio.Volume.get();',
        ].join('\n'),
      },
      {
        id: 'middle',
        path: 'middle.js',
        source: "import './helper.js';",
      },
      {
        id: 'helper',
        path: 'helper.js',
        source: "import xapi from 'xapi';\nxapi.Status.Audio.Volume.get();",
      },
      {
        id: 'other',
        path: 'other.js',
        source: "import xapi from 'xapi';\nxapi.Status.Audio.Volume.get();",
      },
    ], ['main', 'other']);
    const linkedOverlap = report.findings.find((finding) =>
      finding.code === 'source.linked-cross-macro-xapi-overlap');
    const separateOverlap = report.findings.find((finding) =>
      finding.code === 'source.separate-cross-macro-xapi-overlap');

    expect(linkedOverlap).toEqual(expect.objectContaining({
      priority: 'advisory',
      affectedEntryMacroIds: ['main'],
      sourceFileIds: ['helper', 'main'],
    }));
    expect(separateOverlap).toEqual(expect.objectContaining({
      priority: 'informational',
      affectedEntryMacroIds: ['main', 'other'],
      sourceFileIds: ['helper', 'main', 'other'],
    }));
    expect(report.findingImpacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        findingId: linkedOverlap?.id,
        sourceFileId: 'helper',
        entryMacroId: 'main',
        impact: 'dependency',
        dependencyPath: ['main', 'middle', 'helper'],
      }),
    ]));
  });

  it('does not create a cross-file Mixed Syntax Finding for internally consistent macros', () => {
    const report = analyze([
      {
        id: 'old',
        path: 'old.js',
        source: "import xapi from 'xapi';\nxapi.status.get('Audio Volume');",
      },
      {
        id: 'modern',
        path: 'modern.js',
        source: "import xapi from 'xapi';\nxapi.Status.Audio.Volume.get();",
      },
    ], ['old', 'modern']);

    expect(report.findings.filter((finding) =>
      finding.code === 'source.old-style-xapi')).toEqual([
      expect.objectContaining({ priority: 'advisory' }),
    ]);
    expect(report.findings.filter((finding) =>
      finding.code === 'source.mixed-xapi-syntax')).toEqual([]);
  });

  it('respects a proven non-xapi reassignment without creating a later touchpoint', () => {
    const report = analyze([{
      id: 'main',
      path: 'main.js',
      source: [
        "import xapi from 'xapi';",
        'let api = xapi;',
        'api.Status.Audio.Volume.get();',
        'api = {};',
        'api.Status.Audio.Volume.get();',
      ].join('\n'),
    }], ['main']);

    expect(report.inventory.references).toHaveLength(1);
    expect(report.coverage.xapiReferences.staticallyResolved).toBe(1);
    expect(report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'coverage.xapi-flow-frontier' }),
    ]));
  });

  it('keeps dynamic canonical paths partial without a display expression or documentation guess', () => {
    const report = analyze([{
      id: 'main',
      path: 'main.js',
      source: [
        "import xapi from 'xapi';",
        "const section = 'Audio';",
        'xapi.Status[section].Volume.get();',
      ].join('\n'),
    }], ['main']);
    const dynamic = report.observationLedger.find((observation) =>
      observation.kind === 'xapi-touchpoint');

    expect(dynamic).toEqual(expect.objectContaining({
      canonicalReference: {
        kind: 'Status',
        normalizedPathSegments: [],
        operation: 'get',
        complete: false,
        limitation: expect.any(String),
      },
    }));
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'coverage.xapi-flow-frontier', priority: 'advisory' }),
    ]));
  });

  it('recognizes versioned macro globals and retains only unresolved names as neutral observations', () => {
    const report = analyze([{
      id: 'main',
      path: 'main.js',
      source: [
        'console.log("ready");',
        'setTimeout(() => console.log("later"), 10);',
        'missingBinding();',
      ].join('\n'),
    }], ['main']);
    const unresolved = report.observationLedger.filter((observation) =>
      observation.kind === 'unresolved-identifier');

    expect(unresolved).toEqual([
      expect.objectContaining({ identifier: 'missingBinding' }),
    ]);
    expect(report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'source.unresolved-identifier' }),
    ]));
    expect(report.provenance.recognizedMacroGlobals.version).toBe('1.0.0');
  });

  it('keeps the semantic report projection deterministic as a golden contract', () => {
    const report = analyze([{
      id: 'main',
      path: 'main.js',
      source: "import xapi from 'xapi';\nxapi.Status.Audio.Volume.get();",
    }], ['main']);

    expect({
      schemaVersion: report.schemaVersion,
      provenance: report.provenance,
      inventory: report.fileInventory.map(({ fileId, roles, analysisState }) => ({
        fileId,
        roles,
        analysisState,
      })),
      observationKinds: report.observationLedger.map((observation) => observation.kind),
      findingCodes: report.findings.map((finding) => finding.code),
      completeness: report.coverage.completeness,
    }).toEqual({
      schemaVersion: '2.3.0',
      provenance: expect.objectContaining({
        reportSchema: { id: 'analysis-report', version: '2.3.0' },
        schemaSnapshot: expect.objectContaining({
          id: 'roomos-test',
          upstreamUpdatedAt: '2026-07-01T00:00:00.000Z',
        }),
      }),
      inventory: [{
        fileId: 'main',
        roles: ['Entry'],
        analysisState: 'Evaluated',
      }],
      observationKinds: ['xapi-root-binding', 'xapi-touchpoint'],
      findingCodes: [],
      completeness: 'complete-for-explicit-source-evidence',
    });
  });
});
