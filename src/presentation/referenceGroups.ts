import type {
  ApiKind,
  ApiReference,
  FileInventoryEntry,
} from '../analysis/types';

export interface ReferenceGroup {
  key: string;
  kind: ApiKind;
  path: string;
  references: ApiReference[];
}

export interface MacroReferenceGroup {
  fileId: string;
  title: string;
  referenceGroups: ReferenceGroup[];
  totalUses: number;
}

export function groupReferences(references: readonly ApiReference[]): ReferenceGroup[] {
  const groups = new Map<string, ReferenceGroup>();
  for (const reference of references) {
    const key = `${reference.kind}|${reference.path}`;
    const group = groups.get(key) ?? {
      key,
      kind: reference.kind,
      path: reference.path,
      references: [],
    };
    group.references.push(reference);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.path.localeCompare(right.path),
  );
}

export function groupReferencesByMacro(
  files: readonly FileInventoryEntry[],
  references: readonly ApiReference[],
): MacroReferenceGroup[] {
  const filesById = new Map(files.map((file) => [file.fileId, file]));
  const referencesByFileId = new Map<string, ApiReference[]>();

  for (const reference of references) {
    const fileId = reference.source.fileId;
    const fileReferences = referencesByFileId.get(fileId) ?? [];
    fileReferences.push(reference);
    referencesByFileId.set(fileId, fileReferences);
  }

  return [...referencesByFileId.entries()]
    .map(([fileId, fileReferences]): MacroReferenceGroup => ({
      fileId,
      title: filesById.get(fileId)?.path ?? fileId,
      referenceGroups: groupReferences(fileReferences),
      totalUses: fileReferences.length,
    }))
    .sort((left, right) =>
      left.title.localeCompare(right.title) || left.fileId.localeCompare(right.fileId),
    );
}
