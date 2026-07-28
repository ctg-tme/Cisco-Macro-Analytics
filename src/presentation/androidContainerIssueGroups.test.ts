import { describe, expect, it } from 'vitest';
import type { ApiKind, FileInventoryEntry } from '../analysis/types';
import type { AndroidContainerIssue } from './androidContainerReadiness';
import { groupAndroidContainerIssuesByMacro } from './androidContainerIssueGroups';

const files: FileInventoryEntry[] = [
  {
    fileId: 'alpha',
    path: 'alpha.js',
    contentHash: 'alpha',
    roles: ['Entry'],
    activeState: 'Unknown',
    analysisState: 'Evaluated',
    affectedEntryMacroIds: ['alpha'],
  },
  {
    fileId: 'beta',
    path: 'beta.js',
    contentHash: 'beta',
    roles: ['Entry'],
    activeState: 'Unknown',
    analysisState: 'Evaluated',
    affectedEntryMacroIds: ['beta'],
  },
  {
    fileId: 'gamma',
    path: 'gamma.js',
    contentHash: 'gamma',
    roles: ['Entry'],
    activeState: 'Unknown',
    analysisState: 'Evaluated',
    affectedEntryMacroIds: ['gamma'],
  },
];

function issue(
  kind: ApiKind,
  path: string,
  reason: AndroidContainerIssue['reason'],
): AndroidContainerIssue {
  return { key: `${kind}|${path}`, kind, path, reason };
}

function reference(kind: ApiKind, path: string, fileId: string) {
  return {
    kind,
    path,
    source: { fileId },
  };
}

describe('groupAndroidContainerIssuesByMacro', () => {
  it('groups issues by source macro and keeps multi-source paths in a final coordination group', () => {
    const explicitlyUnavailable = issue(
      'Command',
      'UserInterface Extensions WebApp Save',
      'explicitly-unavailable',
    );
    const notFound = issue('Configuration', 'Audio DefaultVolume', 'not-found');
    const unknown = issue('Status', 'Audio Volume', 'unknown');
    const shared = issue('Event', 'CallDisconnect', 'explicitly-unavailable');

    const groups = groupAndroidContainerIssuesByMacro(files, [
      reference(unknown.kind, unknown.path, 'alpha'),
      reference(explicitlyUnavailable.kind, explicitlyUnavailable.path, 'beta'),
      reference(notFound.kind, notFound.path, 'gamma'),
      reference(shared.kind, shared.path, 'alpha'),
      reference(shared.kind, shared.path, 'beta'),
    ], [unknown, explicitlyUnavailable, notFound, shared]);

    expect(groups.map(({ key, counts, issues }) => ({
      key,
      counts,
      issueKeys: issues.map((item) => item.key),
    }))).toEqual([
      {
        key: 'macro:beta',
        counts: { 'explicitly-unavailable': 1, 'not-found': 0, unknown: 0 },
        issueKeys: [explicitlyUnavailable.key],
      },
      {
        key: 'macro:gamma',
        counts: { 'explicitly-unavailable': 0, 'not-found': 1, unknown: 0 },
        issueKeys: [notFound.key],
      },
      {
        key: 'macro:alpha',
        counts: { 'explicitly-unavailable': 0, 'not-found': 0, unknown: 1 },
        issueKeys: [unknown.key],
      },
      {
        key: 'cross-macro',
        counts: { 'explicitly-unavailable': 1, 'not-found': 0, unknown: 0 },
        issueKeys: [shared.key],
      },
    ]);
  });
});
