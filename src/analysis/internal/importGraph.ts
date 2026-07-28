import type { MacroFile } from '../types';
import {
  parseMacroFile,
  type ParseResult,
  type ParsedFile,
  type StaticModuleReference,
} from './parser';

export function normalizePath(path: string): string {
  const segments: string[] = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return segments.join('/');
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}

function importCandidates(importerPath: string, specifier: string): string[] {
  const base = normalizePath(`${dirname(importerPath)}/${specifier}`);
  const extension = /\.(?:c?js|mjs)$/i.test(base);
  return extension
    ? [base]
    : [base, `${base}.js`, `${base}.mjs`, `${base}/index.js`];
}

export function normalizedExpectedPath(importerPath: string, specifier: string): string {
  const base = normalizePath(`${dirname(importerPath)}/${specifier}`);
  if (/\.(?:c?js|mjs)$/i.test(base)) return base;
  return `${base}.js`;
}

export interface ResolvedImport {
  importer: MacroFile;
  dependency: MacroFile;
  reference: StaticModuleReference;
}

export interface UnresolvedImport {
  importer: MacroFile;
  normalizedExpectedPath: string;
  reference: StaticModuleReference;
}

export interface GraphResult {
  files: MacroFile[];
  entries: MacroFile[];
  defaultEntryMacroIds: string[];
  reachable: MacroFile[];
  parsedById: Map<string, ParsedFile>;
  parseResults: Map<string, ParseResult>;
  entriesByFileId: Map<string, string[]>;
  directEdges: ResolvedImport[];
  allUnresolved: UnresolvedImport[];
  unresolved: UnresolvedImport[];
  dynamicImportCount: number;
  routesByEntryAndFile: Map<string, string[]>;
}

function stronglyConnectedComponents(fileIds: string[], adjacency: Map<string, Set<string>>): string[][] {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  function visit(id: string): void {
    indices.set(id, nextIndex);
    lowLinks.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);

    for (const dependency of adjacency.get(id) ?? []) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(id, Math.min(lowLinks.get(id) ?? 0, lowLinks.get(dependency) ?? 0));
      } else if (onStack.has(dependency)) {
        lowLinks.set(id, Math.min(lowLinks.get(id) ?? 0, indices.get(dependency) ?? 0));
      }
    }

    if (lowLinks.get(id) !== indices.get(id)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop();
      if (!member) break;
      onStack.delete(member);
      component.push(member);
      if (member === id) break;
    }
    components.push(component.sort());
  }

  for (const id of fileIds) {
    if (!indices.has(id)) visit(id);
  }
  return components;
}

function graphParts(files: MacroFile[]): {
  parseResults: Map<string, ParseResult>;
  parsedById: Map<string, ParsedFile>;
  directEdges: ResolvedImport[];
  unresolved: UnresolvedImport[];
} {
  const fileByPath = new Map(files.map((file) => [normalizePath(file.path), file]));
  const parseResults = new Map<string, ParseResult>();
  const parsedById = new Map<string, ParsedFile>();
  const directEdges: ResolvedImport[] = [];
  const unresolved: UnresolvedImport[] = [];

  for (const file of files) {
    const result = parseMacroFile(file);
    parseResults.set(file.id, result);
    if (result.kind === 'parsed') parsedById.set(file.id, result.parsed);
  }

  for (const file of files) {
    const parsed = parsedById.get(file.id);
    if (!parsed) continue;
    for (const reference of parsed.localImports) {
      const dependency = importCandidates(file.path, reference.specifier)
        .map((candidate) => fileByPath.get(candidate))
        .find((candidate): candidate is MacroFile => Boolean(candidate));
      if (dependency) directEdges.push({ importer: file, dependency, reference });
      else {
        unresolved.push({
          importer: file,
          normalizedExpectedPath: normalizedExpectedPath(file.path, reference.specifier),
          reference,
        });
      }
    }
  }
  return { parseResults, parsedById, directEdges, unresolved };
}

function defaultEntries(files: MacroFile[], directEdges: ResolvedImport[]): string[] {
  const adjacency = new Map<string, Set<string>>(files.map((file) => [file.id, new Set()]));
  for (const edge of directEdges) adjacency.get(edge.importer.id)?.add(edge.dependency.id);
  const components = stronglyConnectedComponents(files.map((file) => file.id), adjacency);
  const componentByFile = new Map<string, number>();
  components.forEach((component, index) => {
    for (const fileId of component) componentByFile.set(fileId, index);
  });
  const incomingComponents = new Set<number>();
  for (const edge of directEdges) {
    const from = componentByFile.get(edge.importer.id);
    const to = componentByFile.get(edge.dependency.id);
    if (from !== undefined && to !== undefined && from !== to) incomingComponents.add(to);
  }
  return components
    .flatMap((component, index) => incomingComponents.has(index) ? [] : component)
    .sort((left, right) => {
      const leftPath = files.find((file) => file.id === left)?.path ?? left;
      const rightPath = files.find((file) => file.id === right)?.path ?? right;
      return leftPath.localeCompare(rightPath);
    });
}

export function defaultEntryMacroIds(files: MacroFile[]): string[] {
  return defaultEntries(files, graphParts(files).directEdges);
}

export function buildImportGraph(files: MacroFile[], selectedEntryMacroIds?: string[]): GraphResult {
  const fileById = new Map(files.map((file) => [file.id, file]));
  const { parseResults, parsedById, directEdges, unresolved } = graphParts(files);
  const defaultEntryIds = defaultEntries(files, directEdges);
  const entryIds = selectedEntryMacroIds && selectedEntryMacroIds.length > 0
    ? [...new Set(selectedEntryMacroIds)]
    : defaultEntryIds;
  const entries = entryIds
    .map((id) => fileById.get(id))
    .filter((file): file is MacroFile => Boolean(file));

  const outgoing = new Map<string, Set<string>>();
  for (const edge of directEdges) {
    const dependencies = outgoing.get(edge.importer.id) ?? new Set<string>();
    dependencies.add(edge.dependency.id);
    outgoing.set(edge.importer.id, dependencies);
  }

  const entriesByFile = new Map<string, Set<string>>();
  const routesByEntryAndFile = new Map<string, string[]>();
  for (const entry of entries) {
    const queue: Array<{ fileId: string; route: string[] }> = [{ fileId: entry.id, route: [entry.id] }];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current.fileId)) continue;
      visited.add(current.fileId);
      const memberships = entriesByFile.get(current.fileId) ?? new Set<string>();
      memberships.add(entry.id);
      entriesByFile.set(current.fileId, memberships);
      routesByEntryAndFile.set(`${entry.id}:${current.fileId}`, current.route);
      for (const dependencyId of outgoing.get(current.fileId) ?? []) {
        queue.push({ fileId: dependencyId, route: [...current.route, dependencyId] });
      }
    }
  }

  const entriesByFileId = new Map(
    [...entriesByFile].map(([fileId, memberships]) => [fileId, [...memberships].sort()]),
  );
  const reachableIds = new Set(entriesByFileId.keys());
  const dynamicImportCount = [...parsedById.values()]
    .filter((parsed) => reachableIds.has(parsed.file.id))
    .reduce((count, parsed) => count + parsed.dynamicImports.length, 0);

  return {
    files,
    entries,
    defaultEntryMacroIds: defaultEntryIds,
    reachable: files.filter((file) => reachableIds.has(file.id)),
    parsedById,
    parseResults,
    entriesByFileId,
    directEdges,
    allUnresolved: unresolved,
    unresolved: unresolved.filter((edge) => reachableIds.has(edge.importer.id)),
    dynamicImportCount,
    routesByEntryAndFile,
  };
}
