import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import { analyzeMacroSet } from './analyzeMacroSet';
import type { AnalysisInput, SchemaSnapshot } from './types';
import reportSchema from './report.schema.json';

const schemaSnapshot: SchemaSnapshot = {
  id: 'roomos-11.27.2.0-test',
  release: '11.27.2.0',
  sha256: 'fixture-sha',
  upstreamUpdatedAt: '2026-07-01T00:00:00.000Z',
  objectCount: 7,
  objects: [
    {
      type: 'Command',
      path: 'Audio Volume Set',
      products: ['room_bar'],
      attributes: {
        role: ['Admin', 'Integrator'],
        params: [{ name: 'Level', type: 'integer', minimum: 0, maximum: 100, required: true }],
      },
    },
    {
      type: 'Status',
      path: 'Audio Volume',
      products: ['room_bar'],
      attributes: { role: ['Admin', 'Integrator', 'User'] },
    },
    {
      type: 'Configuration',
      path: 'Audio DefaultVolume',
      products: ['room_bar'],
      attributes: {
        role: ['Admin', 'Integrator'],
        valueSpace: { type: 'integer', minimum: 0, maximum: 100 },
      },
    },
    {
      type: 'Status',
      path: 'Video Input Connector[1] Connected',
      normPath: 'Video Input Connector Connected',
      products: ['room_bar'],
      attributes: { role: ['Admin', 'Integrator', 'User'] },
    },
    {
      type: 'Status',
      path: 'Video Input Connector[1] SignalState',
      normPath: 'Video Input Connector SignalState',
      products: ['room_bar'],
      attributes: { role: ['Admin', 'Integrator', 'User'] },
    },
    {
      type: 'Event',
      path: 'UserInterface Extensions Widget Action',
      products: ['room_bar'],
      attributes: { role: ['Admin', 'Integrator', 'User'] },
    },
    {
      type: 'Command',
      path: 'UserInterface Extensions Panel Save',
      products: ['room_bar'],
      attributes: {
        role: ['Admin', 'Integrator'],
        params: [{ name: 'PanelId', required: true, valuespace: { type: 'String' } }],
      },
    },
  ],
};

function input(files: AnalysisInput['macroSet']['files']): AnalysisInput {
  return {
    macroSet: { files, entryMacroIds: ['main'] },
    target: {
      kind: 'declared',
      release: '11.27.2.0',
      productModel: 'room_bar',
      operatingMode: 'Native',
      runtimeRole: 'Integrator',
    },
    schemaSnapshot,
    rulePack: {
      id: 'roomos-macro-rules',
      version: '1.0.0',
      rules: [
        {
          id: 'syntax.commonjs',
          kind: 'commonjs-deprecation',
          title: 'CommonJS macro syntax is deprecated',
          citation: 'https://roomos.cisco.com/doc/TechDocs/MacroTutorial',
          appliesTo: { minimumRelease: '11.0.0' },
        },
      ],
    },
    analysisTime: '2026-07-22T12:00:00.000Z',
  };
}

describe('analyzeMacroSet', () => {
  it('builds a deterministic report from an entry macro and its local import', () => {
    const result = analyzeMacroSet(input([
      {
        id: 'main',
        path: 'main.js',
        source: [
          "import xapi from 'xapi';",
          "import './volume.js';",
          "xapi.Command.Audio.Volume.Set({ Level: 120 });",
          "xapi.Status.Audio[statusName].get();",
        ].join('\n'),
      },
      {
        id: 'volume',
        path: 'volume.js',
        source: "import xapi from 'xapi';\nxapi.Config.Audio.DefaultVolume.set(50);",
      },
      {
        id: 'unused',
        path: 'unused.js',
        source: "import xapi from 'xapi';\nxapi.Command.Audio.Volume.Set({ Level: 10 });",
      },
    ]));

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;

    expect(result.report.generatedAt).toBe('2026-07-22T12:00:00.000Z');
    expect(result.report.coverage.files).toEqual({
      supplied: 3,
      reachable: 2,
      parsed: 2,
      failed: 0,
      notInAnalyzedGraph: 1,
    });
    expect(result.report.observationCoverage.find((coverage) =>
      coverage.fileId === 'unused')?.families).toEqual(expect.arrayContaining([
      expect.objectContaining({
        family: 'xapi-touchpoints',
        state: 'Not evaluated',
        reason: expect.any(String),
      }),
    ]));
    expect(result.report.coverage.xapiReferences).toEqual({
      candidates: 4,
      staticallyResolved: 2,
      dynamic: 1,
      dynamicArguments: 0,
    });
    expect(result.report.inventory.references.map((reference) => reference.path)).toEqual([
      'Audio DefaultVolume',
      'Audio Volume Set',
    ]);
    expect(result.report.inventory.references[1]?.source.range.start).toEqual({ line: 3, column: 1 });
    expect(result.report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'schema.literal-out-of-range', evidence: 'potential-risk', priority: 'required' }),
      expect.objectContaining({ code: 'coverage.xapi-flow-frontier', evidence: 'unknown', priority: 'warning' }),
    ]));
    expect(JSON.stringify(result.report)).not.toContain('{ Level: 120 }');
  });

  it('reports parse failure without pretending the analysis is complete', () => {
    const result = analyzeMacroSet(input([
      { id: 'main', path: 'main.js', source: "import './bad.js';\nexport const ready = true;" },
      { id: 'bad', path: 'bad.js', source: "import xapi from 'xapi';\nxapi.Command.Audio.Volume.Set({" },
    ]));

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.coverage.files.failed).toBe(1);
    expect(result.report.findings[0]).toEqual(expect.objectContaining({
      code: 'coverage.parse-failure',
      evidence: 'unknown',
      priority: 'warning',
    }));
  });

  it('returns an Analysis Failure when no entry-reachable macro can be parsed', () => {
    const result = analyzeMacroSet(input([
      { id: 'main', path: 'main.js', source: "import xapi from 'xapi';\nxapi.Command.Audio.Volume.Set({" },
    ]));
    expect(result).toEqual({
      kind: 'analysis-failure',
      failure: expect.objectContaining({ code: 'no-usable-macro' }),
    });
  });

  it('handles a statically false if statement without an else branch', () => {
    const result = analyzeMacroSet(input([
      {
        id: 'main',
        path: 'main.js',
        source: [
          "import xapi from 'xapi';",
          'if (false) {',
          '  xapi.Status.Audio.Volume.get();',
          '}',
          'xapi.Status.Audio.Volume.get();',
        ].join('\n'),
      },
    ]));

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.inventory.references).toHaveLength(1);
  });

  it('keeps API availability distinct from endpoint setup and health', () => {
    const result = analyzeMacroSet(input([
      { id: 'main', path: 'main.js', source: "import xapi from 'xapi';\nxapi.Status.Audio.Volume.get();" },
    ]));

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.inventory.references[0]).toEqual(expect.objectContaining({
      availability: 'available-in-declared-schema',
    }));
    expect(result.report.limitations).toContain(
      'Schema availability means that an xAPI path appears in pinned schema evidence; it does not establish endpoint configuration, permissions, physical interfaces, runtime state, or compatibility.',
    );
  });

  it('matches legacy xAPI paths case-insensitively while preserving source evidence', () => {
    const result = analyzeMacroSet(input([
      {
        id: 'main',
        path: 'main.js',
        source: [
          "import xapi from 'xapi';",
          "xapi.command('Userinterface Extensions Panel Save', { PanelId: 'usb-mode' }, '<Extensions/>');",
        ].join('\n'),
      },
    ]));

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.inventory.references[0]).toEqual(expect.objectContaining({
      path: 'UserInterface Extensions Panel Save',
      syntax: 'legacy',
      availability: 'available-in-declared-schema',
      schemaEvidence: expect.objectContaining({
        existsInSnapshot: true,
        matchKind: 'exact',
        documentationUrl: 'https://roomos.cisco.com/xapi/Command.UserInterface.Extensions.Panel.Save/',
        parameters: [expect.objectContaining({ name: 'PanelId', required: true })],
      }),
    }));
    expect(result.report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'schema.api-not-available' }),
    ]));
    expect(result.report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'schema.path-casing-mismatch',
        evidence: 'observed-finding',
        priority: 'advisory',
        details: {
          schemaPath: 'UserInterface Extensions Panel Save',
        },
      }),
    ]));

    const canonicalResult = analyzeMacroSet(input([
      {
        id: 'main',
        path: 'main.js',
        source: "import xapi from 'xapi';\nxapi.command('UserInterface Extensions Panel Save', { PanelId: 'usb-mode' }, '<Extensions/>');",
      },
    ]));
    expect(canonicalResult.kind).toBe('report');
    if (canonicalResult.kind !== 'report') return;
    expect(canonicalResult.report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'schema.path-casing-mismatch' }),
    ]));
  });

  it('reports an event as unavailable when a snapshot omits the entire Event branch', () => {
    const analysisInput = input([
      {
        id: 'main',
        path: 'main.js',
        source: "import xapi from 'xapi';\nxapi.Event.CallDisconnect.on(() => {});",
      },
    ]);
    const objects = schemaSnapshot.objects.filter((object) => object.type !== 'Event');
    analysisInput.schemaSnapshot = {
      ...schemaSnapshot,
      objectCount: objects.length,
      objects,
    };

    const result = analyzeMacroSet(analysisInput);

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.inventory.references[0]).toEqual(expect.objectContaining({
      kind: 'Event',
      path: 'CallDisconnect',
      availability: 'not-in-declared-schema',
      schemaEvidence: expect.objectContaining({
        existsInSnapshot: false,
        matchKind: 'none',
      }),
    }));
    expect(result.report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'schema.api-not-available',
        evidence: 'potential-risk',
        priority: 'required',
      }),
    ]));
  });

  it('treats a snapshot without Android Container metadata as unsupported', () => {
    const analysisInput = input([
      {
        id: 'main',
        path: 'main.js',
        source: "import xapi from 'xapi';\nxapi.Event.UserInterface.Extensions.Widget.Action.on(() => {});",
      },
    ]);
    analysisInput.target = {
      kind: 'declared',
      release: '11.27.2.0',
      productModel: 'room_bar',
      operatingMode: 'MTR',
      runtimeRole: 'Integrator',
    };
    const result = analyzeMacroSet(analysisInput);

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.inventory.references[0]).toEqual(expect.objectContaining({
      availability: 'unavailable-for-mode',
      schemaEvidence: expect.objectContaining({
        operatingMode: expect.objectContaining({
          status: 'not-supported',
          supportsMtr: false,
          basis: 'missing-metadata',
        }),
      }),
    }));
    expect(result.report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'schema.operating-mode-restriction',
        evidence: 'potential-risk',
      }),
    ]));
  });

  it('treats an absent Configuration extension marker as unavailable in an MTR-aware snapshot', () => {
    const analysisInput = input([
      {
        id: 'main',
        path: 'main.js',
        source: "import xapi from 'xapi';\nxapi.Config.Audio.DefaultVolume.get();",
      },
    ]);
    analysisInput.target = {
      kind: 'declared',
      release: '11.27.2.0',
      productModel: 'room_bar',
      operatingMode: 'MTR',
      runtimeRole: 'Integrator',
    };
    analysisInput.schemaSnapshot = {
      ...schemaSnapshot,
      objectCount: schemaSnapshot.objectCount + 1,
      objects: [
        ...schemaSnapshot.objects,
        {
          type: 'Configuration',
          path: 'Audio USB Mode',
          products: ['room_bar'],
          attributes: {
            role: ['Admin', 'Integrator'],
            include_for_extension: 'mtr',
          },
        },
      ],
    };
    const result = analyzeMacroSet(analysisInput);

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.inventory.references[0]).toEqual(expect.objectContaining({
      availability: 'unavailable-for-mode',
      schemaEvidence: expect.objectContaining({
        operatingMode: expect.objectContaining({
          status: 'not-supported',
          supportsMtr: false,
          basis: 'extension-marker',
        }),
      }),
    }));
  });

  it('treats a Command without Teams unavailable states as available in a denylist snapshot', () => {
    const analysisInput = input([
      {
        id: 'main',
        path: 'main.js',
        source: "import xapi from 'xapi';\nxapi.Command.Audio.Volume.Set({ Level: 50 });",
      },
    ]);
    analysisInput.target = {
      kind: 'declared',
      release: '26.7.1',
      productModel: 'room_bar',
      operatingMode: 'MTR',
      runtimeRole: 'Integrator',
    };
    analysisInput.schemaSnapshot = {
      ...schemaSnapshot,
      release: '26.7.1',
      objects: schemaSnapshot.objects.map((object) =>
        object.type === 'Command' && object.path === 'UserInterface Extensions Panel Save'
          ? {
              ...object,
              attributes: {
                ...object.attributes,
                unavailableStates: 'MicrosoftTeamsInstalled;MicrosoftTeamsInCall',
              },
            }
          : object),
    };
    const result = analyzeMacroSet(analysisInput);

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.inventory.references[0]).toEqual(expect.objectContaining({
      availability: 'available-in-declared-schema',
      schemaEvidence: expect.objectContaining({
        operatingMode: expect.objectContaining({
          status: 'supported',
          supportsMtr: true,
          basis: 'teams-unavailable-state',
        }),
      }),
    }));
  });

  it('treats an absent Command extension marker as unavailable in an allowlist snapshot', () => {
    const analysisInput = input([
      {
        id: 'main',
        path: 'main.js',
        source: "import xapi from 'xapi';\nxapi.Command.Audio.Volume.Set({ Level: 50 });",
      },
    ]);
    analysisInput.target = {
      kind: 'declared',
      release: '11.27.2.0',
      productModel: 'room_bar',
      operatingMode: 'MTR',
      runtimeRole: 'Integrator',
    };
    analysisInput.schemaSnapshot = {
      ...schemaSnapshot,
      objects: schemaSnapshot.objects.map((object) =>
        object.type === 'Command' && object.path === 'UserInterface Extensions Panel Save'
          ? {
              ...object,
              attributes: {
                ...object.attributes,
                include_for_extension: 'mtr',
              },
            }
          : object),
    };
    const result = analyzeMacroSet(analysisInput);

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.inventory.references[0]).toEqual(expect.objectContaining({
      availability: 'unavailable-for-mode',
      schemaEvidence: expect.objectContaining({
        operatingMode: expect.objectContaining({
          status: 'not-supported',
          supportsMtr: false,
          basis: 'extension-marker',
        }),
      }),
    }));
  });

  it('treats Events as available when their feature exists in an MTR-aware snapshot', () => {
    const analysisInput = input([
      {
        id: 'main',
        path: 'main.js',
        source: "import xapi from 'xapi';\nxapi.Event.UserInterface.Extensions.Widget.Action.on(() => {});",
      },
    ]);
    analysisInput.target = {
      kind: 'declared',
      release: '11.27.2.0',
      productModel: 'room_bar',
      operatingMode: 'MTR',
      runtimeRole: 'Integrator',
    };
    analysisInput.schemaSnapshot = {
      ...schemaSnapshot,
      objects: schemaSnapshot.objects.map((object) =>
        object.type === 'Status' && object.path === 'Audio Volume'
          ? { ...object, attributes: { ...object.attributes, include_for_extension: 'mtr' } }
          : object),
    };
    const result = analyzeMacroSet(analysisInput);

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.inventory.references[0]).toEqual(expect.objectContaining({
      availability: 'available-in-declared-schema',
      schemaEvidence: expect.objectContaining({
        operatingMode: expect.objectContaining({
          status: 'supported',
          supportsMtr: true,
          basis: 'feature-dependent-event',
        }),
      }),
    }));
  });

  it('uses an explicit extension marker as available Android Container evidence', () => {
    const analysisInput = input([
      {
        id: 'main',
        path: 'main.js',
        source: "import xapi from 'xapi';\nxapi.Status.Audio.Volume.get();",
      },
    ]);
    analysisInput.target = {
      kind: 'declared',
      release: '11.27.2.0',
      productModel: 'room_bar',
      operatingMode: 'MTR',
      runtimeRole: 'Integrator',
    };
    analysisInput.schemaSnapshot = {
      ...schemaSnapshot,
      objects: schemaSnapshot.objects.map((object) =>
        object.type === 'Status' && object.path === 'Audio Volume'
          ? { ...object, attributes: { ...object.attributes, include_for_extension: 'mtr' } }
          : object),
    };
    const result = analyzeMacroSet(analysisInput);

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.inventory.references[0]).toEqual(expect.objectContaining({
      availability: 'available-in-declared-schema',
      schemaEvidence: expect.objectContaining({
        operatingMode: expect.objectContaining({
          status: 'supported',
          supportsMtr: true,
          basis: 'extension-marker',
        }),
      }),
    }));
  });

  it('keeps conflicting product variants unknown instead of trusting the first schema object', () => {
    const analysisInput = input([
      {
        id: 'main',
        path: 'main.js',
        source: "import xapi from 'xapi';\nxapi.Status.Audio.Volume.get();",
      },
    ]);
    analysisInput.target = {
      kind: 'declared',
      release: '26.7.1',
      productModel: 'room_bar',
      operatingMode: 'MTR',
      runtimeRole: 'Integrator',
    };
    const volumeStatus = schemaSnapshot.objects.find((object) =>
      object.type === 'Status' && object.path === 'Audio Volume')!;
    analysisInput.schemaSnapshot = {
      ...schemaSnapshot,
      release: '26.7.1',
      objectCount: schemaSnapshot.objectCount + 1,
      objects: [
        ...schemaSnapshot.objects.filter((object) => object !== volumeStatus),
        { ...volumeStatus, attributes: { ...volumeStatus.attributes, include_for_extension: 'mtr' } },
        { ...volumeStatus, id: 'unmarked-variant', attributes: { ...volumeStatus.attributes } },
      ],
    };
    const result = analyzeMacroSet(analysisInput);

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.inventory.references[0]?.schemaEvidence.operatingMode).toEqual(
      expect.objectContaining({
        status: 'unknown',
        supportsMtr: null,
        basis: 'conflicting-metadata',
      }),
    );
  });

  it('uses Microsoft Teams unavailable states as explicit Android Container evidence', () => {
    const analysisInput = input([
      {
        id: 'main',
        path: 'main.js',
        source: "import xapi from 'xapi';\nxapi.Command.Audio.Volume.Set({ Level: 50 });",
      },
    ]);
    analysisInput.target = {
      kind: 'declared',
      release: '26.7.1',
      productModel: 'room_bar',
      operatingMode: 'MTR',
      runtimeRole: 'Integrator',
    };
    analysisInput.schemaSnapshot = {
      ...schemaSnapshot,
      release: '26.7.1',
      objects: schemaSnapshot.objects.map((object) =>
        object.type === 'Command' && object.path === 'Audio Volume Set'
          ? {
              ...object,
              attributes: {
                ...object.attributes,
                unavailableStates: 'MicrosoftTeamsInstalled;MicrosoftTeamsInCall',
              },
            }
          : object),
    };
    const result = analyzeMacroSet(analysisInput);

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.inventory.references[0]).toEqual(expect.objectContaining({
      availability: 'unavailable-for-mode',
      schemaEvidence: expect.objectContaining({
        operatingMode: expect.objectContaining({
          status: 'not-supported',
          supportsMtr: false,
          basis: 'teams-unavailable-state',
        }),
      }),
    }));
    expect(result.report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'schema.operating-mode-restriction', evidence: 'potential-risk' }),
    ]));
  });

  it('does not invent a missing-parameter finding when JavaScript builds arguments at runtime', () => {
    const result = analyzeMacroSet(input([
      {
        id: 'main',
        path: 'main.js',
        source: [
          "import xapi from 'xapi';",
          'const params = getVolumeParameters();',
          'xapi.Command.Audio.Volume.Set(params);',
        ].join('\n'),
      },
    ]));

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'schema.required-parameter-missing' }),
    ]));
    const touchpoint = result.report.observationLedger.find((observation) =>
      observation.kind === 'xapi-touchpoint');
    expect(touchpoint).toEqual(expect.objectContaining({
      argumentShape: expect.objectContaining({
        positions: [
          expect.objectContaining({
            containerForm: 'binding',
            valueForm: 'dynamic',
          }),
        ],
      }),
    }));
  });

  it('follows a statically assigned top-level xAPI branch without executing JavaScript', () => {
    const result = analyzeMacroSet(input([
      {
        id: 'main',
        path: 'main.js',
        source: [
          "import xapi from 'xapi';",
          'const volumeStatus = xapi.Status.Audio.Volume;',
          'volumeStatus.get();',
        ].join('\n'),
      },
    ]));

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.coverage.xapiReferences.staticallyResolved).toBe(1);
    expect(result.report.inventory.references[0]).toEqual(expect.objectContaining({
      kind: 'Status',
      path: 'Audio Volume',
      operation: 'get',
    }));
  });

  it('validates the canonical report and rejects accidental source embedding', () => {
    const result = analyzeMacroSet(input([
      { id: 'main', path: 'main.js', source: "import xapi from 'xapi';\nxapi.Status.Audio.Volume.get();" },
    ]));
    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;

    const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(reportSchema);
    expect(validate(result.report), JSON.stringify(validate.errors)).toBe(true);

    const tampered = structuredClone(result.report) as unknown as {
      inventory: { references: Array<Record<string, unknown>> };
    };
    tampered.inventory.references[0]!.sourceText = "xapi.Status.Audio.Volume.get();";
    expect(validate(tampered)).toBe(false);
  });

  it('resolves static CommonJS modules, inventories legacy calls, and blocks dynamic imports', () => {
    const result = analyzeMacroSet(input([
      {
        id: 'main',
        path: 'main.js',
        source: "const volume = require('./volume');\nimport('./optional.js');\nvolume.start();",
      },
      {
        id: 'volume',
        path: 'volume.js',
        source: "const xapi = require('xapi');\nxapi.command('Audio Volume Set', { Level: 50 });",
      },
    ]));

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.coverage.imports).toEqual({ localResolved: 1, localUnresolved: 0, dynamic: 1 });
    expect(result.report.inventory.references[0]).toEqual(expect.objectContaining({ syntax: 'legacy' }));
    expect(result.report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'coverage.dynamic-import', evidence: 'unknown', priority: 'warning' }),
      expect.objectContaining({
        code: 'source.commonjs-migration',
        evidence: 'observed-finding',
        priority: 'required',
      }),
    ]));
  });

  it('enforces the built-in CommonJS migration policy during Exploratory Analysis', () => {
    const analysisInput = input([
      { id: 'main', path: 'main.js', source: "const xapi = require('xapi');\nxapi.Status.Audio.Volume.get();" },
    ]);
    analysisInput.target = { kind: 'exploratory', partial: {} };
    const result = analyzeMacroSet(analysisInput);

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'source.commonjs-migration',
        evidence: 'observed-finding',
        priority: 'required',
      }),
    ]));
  });

  it('does not emit a Finding when the matching Rule Pack rule is disabled', () => {
    const analysisInput = input([
      { id: 'main', path: 'main.js', source: "const xapi = require('xapi');\nxapi.Status.Audio.Volume.get();" },
    ]);
    analysisInput.rulePack.rules = [{
      id: 'source.commonjs-migration',
      kind: 'commonjs-migration',
      title: 'CommonJS Migration Requirement',
      enabled: false,
      priority: 'required',
      version: '2.0.0',
    }];

    const result = analyzeMacroSet(analysisInput);

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.findings.some((finding) =>
      finding.code === 'source.commonjs-migration')).toBe(false);
  });

  it('applies the configured Review Priority and rule version consistently', () => {
    const analysisInput = input([
      { id: 'main', path: 'main.js', source: "const xapi = require('xapi');\nxapi.Status.Audio.Volume.get();" },
    ]);
    analysisInput.rulePack.rules = [{
      id: 'source.commonjs-migration',
      kind: 'commonjs-migration',
      title: 'CommonJS Migration Requirement',
      enabled: true,
      priority: 'advisory',
      version: '2.1.0',
    }];

    const result = analyzeMacroSet(analysisInput);

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'source.commonjs-migration',
        priority: 'advisory',
        rule: expect.objectContaining({
          id: 'source.commonjs-migration',
          version: '2.1.0',
        }),
      }),
    ]));
  });

  it('applies enablement to rules that were previously unconditional', () => {
    const analysisInput = input([
      {
        id: 'main',
        path: 'main.js',
        source: "import codec from 'xapi';\ncodec.Status.Audio.Volume.get();",
      },
    ]);
    analysisInput.rulePack.rules = [{
      code: 'source.nonstandard-xapi-root',
      id: 'source.nonstandard-xapi-root',
      title: 'Nonstandard xAPI Root Binding',
      enabled: false,
      priority: 'warning',
      version: '2.1.0',
    }];

    const result = analyzeMacroSet(analysisInput);

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.findings.some((finding) =>
      finding.code === 'source.nonstandard-xapi-root')).toBe(false);
  });

  it('follows non-top-level xAPI aliases through lexical scope', () => {
    const result = analyzeMacroSet(input([
      {
        id: 'main',
        path: 'main.js',
        source: [
          "import xapi from 'xapi';",
          'function readVolume() {',
          '  const volume = xapi.Status.Audio.Volume;',
          '  return volume.get();',
          '}',
        ].join('\n'),
      },
    ]));

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.coverage.xapiReferences).toEqual(expect.objectContaining({
      candidates: 1,
      staticallyResolved: 1,
      dynamic: 0,
    }));
    expect(result.report.inventory.references[0]).toEqual(expect.objectContaining({
      kind: 'Status',
      path: 'Audio Volume',
      operation: 'get',
    }));
    expect(result.report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'source.xapi-abstraction',
        evidence: 'observed-finding',
        priority: 'informational',
      }),
    ]));
    expect(result.report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'coverage.xapi-flow-frontier' }),
    ]));
  });

  it('keeps exploratory schema evidence without turning the intentional lack of a Declared Target into a Finding', () => {
    const analysisInput = input([
      {
        id: 'main',
        path: 'main.js',
        source: "import xapi from 'xapi';\nxapi.Command.Audio.Volume.Set({ Level: 120 });",
      },
    ]);
    analysisInput.target = { kind: 'exploratory', partial: { release: '11.27.2.0' } };
    const result = analyzeMacroSet(analysisInput);

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.inventory.references[0]).toEqual(expect.objectContaining({
      availability: 'unknown-in-exploratory-analysis',
      schemaEvidence: expect.objectContaining({
        existsInSnapshot: true,
        documentationUrl: 'https://roomos.cisco.com/xapi/Command.Audio.Volume.Set/',
        product: expect.objectContaining({ status: 'not-declared', supportedProducts: ['room_bar'] }),
        operatingMode: expect.objectContaining({ status: 'not-declared' }),
        role: expect.objectContaining({ status: 'not-declared', allowedRoles: ['Admin', 'Integrator'] }),
        parameters: [expect.objectContaining({ name: 'Level', required: true, minimum: 0, maximum: 100 })],
      }),
    }));
    expect(result.report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'schema.literal-out-of-range' }),
    ]));
    expect(result.report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'coverage.declared-target-incomplete',
      }),
    ]));
  });

  it('recognizes a readable parent branch when the schema stores only descendant paths', () => {
    const result = analyzeMacroSet(input([
      {
        id: 'main',
        path: 'main.js',
        source: "import xapi from 'xapi';\nxapi.Status.Video.Input.Connector.get();",
      },
    ]));

    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    expect(result.report.inventory.references[0]).toEqual(expect.objectContaining({
      kind: 'Status',
      path: 'Video Input Connector',
      availability: 'available-in-declared-schema',
      schemaEvidence: expect.objectContaining({
        existsInSnapshot: true,
        matchKind: 'parent',
        descendantCount: 2,
        descendantPaths: [
          'Video Input Connector Connected',
          'Video Input Connector SignalState',
        ],
      }),
    }));
    expect(result.report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'schema.api-not-available' }),
    ]));
  });
});
