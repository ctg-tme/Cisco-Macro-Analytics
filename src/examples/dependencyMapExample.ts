import type { MacroFile } from '../analysis/types';

export const DEPENDENCY_MAP_EXAMPLE_ENTRY_ID = 'example-room-controller';

export const dependencyMapExampleFiles: MacroFile[] = [
  {
    id: DEPENDENCY_MAP_EXAMPLE_ENTRY_ID,
    path: 'room-controller.js',
    source: [
      "import xapi from 'xapi';",
      "import { applyRoomDefaults } from './room-controls.js';",
      "import { startTelemetry } from './room-telemetry.js';",
      '',
      'applyRoomDefaults();',
      'startTelemetry();',
      'xapi.Status.Video.Input.Connector.get();',
    ].join('\n'),
  },
  {
    id: 'example-room-controls',
    path: 'room-controls.js',
    source: [
      "import xapi from 'xapi';",
      "import { publishRoomSnapshot } from './room-telemetry.js';",
      '',
      'export async function applyRoomDefaults() {',
      '  await xapi.Config.Audio.DefaultVolume.set(50);',
      '  await publishRoomSnapshot();',
      '}',
    ].join('\n'),
  },
  {
    id: 'example-room-telemetry',
    path: 'room-telemetry.js',
    source: [
      "import xapi from 'xapi';",
      '',
      "const telemetryUrl = 'https://telemetry.example.com/v1/rooms';",
      "const panelXml = '<Extensions><Icon>https://assets.example.com/room.png</Icon></Extensions>';",
      '',
      'export async function publishRoomSnapshot() {',
      '  const volume = await xapi.Status.Audio.Volume.get();',
      '  await xapi.Command.HttpClient.Post({',
      '    Url: telemetryUrl,',
      '    Body: panelXml,',
      "    Header: ['Content-Type: application/xml'],",
      '  });',
      '}',
      '',
      'export function startTelemetry() {',
      '  xapi.Status.Audio.Volume.on(() => publishRoomSnapshot());',
      '}',
    ].join('\n'),
  },
];
