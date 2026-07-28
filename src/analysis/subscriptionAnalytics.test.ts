import { describe, expect, it } from 'vitest';
import type { ApiKind, ApiReference } from './types';
import { summarizeSubscriptions } from './subscriptionAnalytics';

function reference(
  id: string,
  kind: ApiKind,
  path: string,
  operation: ApiReference['operation'],
  fileId = 'main',
): ApiReference {
  return {
    id,
    observationId: `observation-${id}`,
    kind,
    path,
    operation,
    syntax: 'modern',
    availability: 'available-in-selected-schema',
    schemaEvidence: {
      existsInSnapshot: true,
      matchKind: 'exact',
      documentationUrl: 'https://roomos.cisco.com/xapi',
      product: { status: 'not-declared', supportedProducts: [] },
      operatingMode: {
        status: 'not-declared',
        supportsMtr: null,
        basis: 'missing-metadata',
      },
      role: { status: 'not-declared', allowedRoles: [] },
      parameters: [],
    },
    entryMacroIds: [fileId],
    source: {
      fileId,
      fileContentHash: 'fixture',
      range: {
        start: { line: 1, column: 0 },
        end: { line: 1, column: 1 },
      },
    },
  };
}

describe('subscription analytics', () => {
  it('reports one registration and one unique path for a single subscription', () => {
    const summary = summarizeSubscriptions([
      reference('one', 'Event', 'CallDisconnect', 'subscribe'),
    ]);

    expect(summary).toEqual(expect.objectContaining({
      totalRegistrations: 1,
      uniqueSubscribedPaths: 1,
      duplicateRegistrations: 0,
    }));
    expect(summary.byBranch.Event).toEqual({
      totalRegistrations: 1,
      uniqueSubscribedPaths: 1,
    });
  });

  it('counts duplicate registrations separately from unique subscribed paths', () => {
    const summary = summarizeSubscriptions([
      reference('one', 'Status', 'Audio Volume', 'subscribe'),
      reference('two', 'Status', 'Audio Volume', 'subscribe'),
    ]);

    expect(summary).toEqual(expect.objectContaining({
      totalRegistrations: 2,
      uniqueSubscribedPaths: 1,
      duplicateRegistrations: 1,
    }));
    expect(summary.byBranch.Status).toEqual({
      totalRegistrations: 2,
      uniqueSubscribedPaths: 1,
    });
  });

  it('counts a subscribed path once when registrations occur in separate files', () => {
    const summary = summarizeSubscriptions([
      reference('one', 'Event', 'CallDisconnect', 'subscribe', 'main'),
      reference('two', 'Event', 'CallDisconnect', 'subscribe', 'helper'),
    ]);

    expect(summary).toEqual(expect.objectContaining({
      totalRegistrations: 2,
      uniqueSubscribedPaths: 1,
      duplicateRegistrations: 1,
    }));
  });

  it('does not count ordinary repeated commands or status reads as subscriptions', () => {
    const summary = summarizeSubscriptions([
      reference('one', 'Command', 'Audio Volume Set', 'execute'),
      reference('two', 'Command', 'Audio Volume Set', 'execute'),
      reference('three', 'Status', 'Audio Volume', 'get'),
      reference('four', 'Status', 'Audio Volume', 'get'),
    ]);

    expect(summary).toEqual(expect.objectContaining({
      totalRegistrations: 0,
      uniqueSubscribedPaths: 0,
      duplicateRegistrations: 0,
    }));
  });
});
