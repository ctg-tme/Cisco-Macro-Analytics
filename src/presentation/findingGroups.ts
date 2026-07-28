import type { FileInventoryEntry, Finding, ReviewPriority } from '../analysis/types';

export interface MacroFindingGroup {
  key: string;
  kind: 'macro' | 'cross-macro';
  title: string;
  fileIds: string[];
  counts: Record<ReviewPriority, number>;
  findings: Finding[];
}

const priorityRank: Record<ReviewPriority, number> = {
  required: 0,
  warning: 1,
  advisory: 2,
  informational: 3,
};

function countsFor(findings: Finding[]): Record<ReviewPriority, number> {
  const counts = { required: 0, warning: 0, advisory: 0, informational: 0 };
  for (const finding of findings) counts[finding.priority] += 1;
  return counts;
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((left, right) =>
    priorityRank[left.priority] - priorityRank[right.priority]
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id));
}

function compareGroupPriority(left: MacroFindingGroup, right: MacroFindingGroup): number {
  const priorities = Object.keys(priorityRank) as ReviewPriority[];
  for (const priority of priorities) {
    const countDifference = right.counts[priority] - left.counts[priority];
    if (countDifference !== 0) return countDifference;
  }
  return left.title.localeCompare(right.title);
}

export function groupFindingsByMacro(
  files: FileInventoryEntry[],
  findings: Finding[],
): MacroFindingGroup[] {
  const filesById = new Map(files.map((file) => [file.fileId, file]));
  const byFileId = new Map<string, Finding[]>();
  const crossMacro: Finding[] = [];

  for (const finding of findings) {
    const sourceFileIds = [...new Set(finding.sourceFileIds)];
    if (sourceFileIds.length !== 1) {
      crossMacro.push(finding);
      continue;
    }
    const fileId = sourceFileIds[0];
    if (!fileId) {
      crossMacro.push(finding);
      continue;
    }
    const group = byFileId.get(fileId) ?? [];
    group.push(finding);
    byFileId.set(fileId, group);
  }

  const macroGroups = [...byFileId.entries()]
    .map(([fileId, groupFindings]): MacroFindingGroup => {
      const sorted = sortFindings(groupFindings);
      return {
        key: `macro:${fileId}`,
        kind: 'macro',
        title: filesById.get(fileId)?.path ?? fileId,
        fileIds: [fileId],
        counts: countsFor(sorted),
        findings: sorted,
      };
    })
    .sort(compareGroupPriority);

  if (crossMacro.length === 0) return macroGroups;
  const sortedCrossMacro = sortFindings(crossMacro);
  return [...macroGroups, {
    key: 'cross-macro',
    kind: 'cross-macro',
    title: 'Cross-macro coordination',
    fileIds: [...new Set(sortedCrossMacro.flatMap((finding) => finding.sourceFileIds))].sort(),
    counts: countsFor(sortedCrossMacro),
    findings: sortedCrossMacro,
  }];
}
