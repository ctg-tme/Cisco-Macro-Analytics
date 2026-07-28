import { describe, expect, it } from 'vitest';
import type { ApiKind, SchemaEvidence } from '../analysis/types';
import { calculateAndroidContainerReadiness } from './androidContainerReadiness';

function reference(
  kind: ApiKind,
  path: string,
  existsInSnapshot: boolean,
  supportsMtr: boolean | null,
  matchKind: SchemaEvidence['matchKind'] = existsInSnapshot ? 'exact' : 'none',
) {
  return {
    kind,
    path,
    schemaEvidence: {
      existsInSnapshot,
      matchKind,
      operatingMode: {
        supportsMtr,
        basis: supportsMtr === true
          ? 'extension-marker'
          : supportsMtr === false
            ? 'teams-unavailable-state'
            : 'missing-metadata',
      },
    } as SchemaEvidence,
  };
}

describe('calculateAndroidContainerReadiness', () => {
  it('reports schema availability across unique xAPI paths', () => {
    const readiness = calculateAndroidContainerReadiness([
      reference('Command', 'Audio Volume Set', true, true),
      reference('Command', 'Audio Volume Set', true, true),
      reference('Status', 'Audio Volume', true, null),
      reference('Command', 'UserInterface Extensions WebApp Save', true, false),
      reference('Configuration', 'Audio DefaultVolume', false, null),
      reference('Event', 'UserInterface Extensions Widget Action', true, true),
      reference('Event', 'CallDisconnect', false, null),
    ]);

    expect(readiness).toEqual({
      total: 6,
      available: 2,
      unavailable: 1,
      unknown: 1,
      notFound: 2,
      determined: 3,
      percentage: 67,
      issues: [
        {
          key: 'Status|Audio Volume',
          kind: 'Status',
          path: 'Audio Volume',
          reason: 'unknown',
        },
        {
          key: 'Command|UserInterface Extensions WebApp Save',
          kind: 'Command',
          path: 'UserInterface Extensions WebApp Save',
          reason: 'explicitly-unavailable',
        },
        {
          key: 'Configuration|Audio DefaultVolume',
          kind: 'Configuration',
          path: 'Audio DefaultVolume',
          reason: 'not-found',
        },
        {
          key: 'Event|CallDisconnect',
          kind: 'Event',
          path: 'CallDisconnect',
          reason: 'not-found',
        },
      ],
    });
  });

  it('leaves the percentage unknown when no static xAPI paths were found', () => {
    expect(calculateAndroidContainerReadiness([])).toEqual({
      total: 0,
      available: 0,
      unavailable: 0,
      unknown: 0,
      notFound: 0,
      determined: 0,
      percentage: null,
      issues: [],
    });
  });
});
