import type { ApiReference, FileInventoryEntry } from '../analysis/types';
import type { AndroidContainerIssue } from './androidContainerReadiness';

export type AndroidContainerIssueReason = AndroidContainerIssue['reason'];

export interface AndroidContainerIssueGroup {
  key: string;
  kind: 'macro' | 'cross-macro';
  title: string;
  fileIds: string[];
  counts: Record<AndroidContainerIssueReason, number>;
  issues: AndroidContainerIssue[];
}

type IssueReference = Pick<ApiReference, 'kind' | 'path'> & {
  source: Pick<ApiReference['source'], 'fileId'>;
};

const reasonRank: Record<AndroidContainerIssueReason, number> = {
  'explicitly-unavailable': 0,
  'not-found': 1,
  unknown: 2,
};

function countsFor(
  issues: AndroidContainerIssue[],
): Record<AndroidContainerIssueReason, number> {
  const counts = { 'explicitly-unavailable': 0, 'not-found': 0, unknown: 0 };
  for (const issue of issues) counts[issue.reason] += 1;
  return counts;
}

function sortIssues(issues: AndroidContainerIssue[]): AndroidContainerIssue[] {
  return [...issues].sort((left, right) =>
    reasonRank[left.reason] - reasonRank[right.reason]
    || left.path.localeCompare(right.path)
    || left.kind.localeCompare(right.kind)
    || left.key.localeCompare(right.key));
}

function compareGroupPriority(
  left: AndroidContainerIssueGroup,
  right: AndroidContainerIssueGroup,
): number {
  const reasons = Object.keys(reasonRank) as AndroidContainerIssueReason[];
  for (const reason of reasons) {
    const countDifference = right.counts[reason] - left.counts[reason];
    if (countDifference !== 0) return countDifference;
  }
  return left.title.localeCompare(right.title);
}

export function groupAndroidContainerIssuesByMacro(
  files: FileInventoryEntry[],
  references: readonly IssueReference[],
  issues: AndroidContainerIssue[],
): AndroidContainerIssueGroup[] {
  const filesById = new Map(files.map((file) => [file.fileId, file]));
  const sourceFileIdsByIssue = new Map<string, Set<string>>();
  for (const reference of references) {
    const key = `${reference.kind}|${reference.path}`;
    const sourceFileIds = sourceFileIdsByIssue.get(key) ?? new Set<string>();
    sourceFileIds.add(reference.source.fileId);
    sourceFileIdsByIssue.set(key, sourceFileIds);
  }

  const byFileId = new Map<string, AndroidContainerIssue[]>();
  const crossMacro: AndroidContainerIssue[] = [];
  for (const issue of issues) {
    const sourceFileIds = [...(sourceFileIdsByIssue.get(issue.key) ?? [])];
    if (sourceFileIds.length !== 1) {
      crossMacro.push(issue);
      continue;
    }
    const fileId = sourceFileIds[0]!;
    const group = byFileId.get(fileId) ?? [];
    group.push(issue);
    byFileId.set(fileId, group);
  }

  const macroGroups = [...byFileId.entries()]
    .map(([fileId, groupIssues]): AndroidContainerIssueGroup => {
      const sorted = sortIssues(groupIssues);
      return {
        key: `macro:${fileId}`,
        kind: 'macro',
        title: filesById.get(fileId)?.path ?? fileId,
        fileIds: [fileId],
        counts: countsFor(sorted),
        issues: sorted,
      };
    })
    .sort(compareGroupPriority);

  if (crossMacro.length === 0) return macroGroups;
  const sortedCrossMacro = sortIssues(crossMacro);
  return [...macroGroups, {
    key: 'cross-macro',
    kind: 'cross-macro',
    title: 'Cross-macro coordination',
    fileIds: [...new Set(sortedCrossMacro.flatMap((issue) =>
      [...(sourceFileIdsByIssue.get(issue.key) ?? [])]))].sort(),
    counts: countsFor(sortedCrossMacro),
    issues: sortedCrossMacro,
  }];
}
