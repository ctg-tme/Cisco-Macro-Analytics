import type {
  CommonJsObservation,
  CredentialIndicatorObservation,
  MacroFile,
  SourceRange,
  UnresolvedIdentifierObservation,
} from '../types';
import {
  childNodes,
  isIdentifierUse,
  patternBindingNames,
  sourceRange,
  type LocatedNode,
  type ParsedFile,
} from './parser';
import { sourceReference, stableHash } from './reportSupport';

export const RECOGNIZED_MACRO_GLOBALS_VERSION = '1.0.0';
export const CREDENTIAL_VOCABULARY_VERSION = '1.0.0';

const recognizedMacroGlobals = new Set([
  'undefined', 'NaN', 'Infinity', 'globalThis',
  'Object', 'Function', 'Boolean', 'Symbol', 'Number', 'BigInt', 'Math', 'Date',
  'String', 'RegExp', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array',
  'BigUint64Array', 'Atomics', 'JSON', 'Promise', 'Proxy', 'Reflect', 'Intl',
  'Error', 'AggregateError', 'EvalError', 'RangeError', 'ReferenceError',
  'SyntaxError', 'TypeError', 'URIError',
  'encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent',
  'parseFloat', 'parseInt', 'isFinite', 'isNaN', 'eval',
  'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'queueMicrotask', 'structuredClone', 'TextEncoder', 'TextDecoder',
  'URL', 'URLSearchParams', 'AbortController', 'AbortSignal', 'Blob',
  // RoomOS exposes CommonJS bindings on runtimes where that module syntax is
  // accepted. The separate source-policy Finding still requires migration.
  'require', 'module', 'exports', '__filename', '__dirname',
]);

interface Scope {
  parent?: Scope;
  kind: 'program' | 'function' | 'block' | 'catch' | 'class';
  bindings: Set<string>;
}

function addPattern(scope: Scope, pattern: LocatedNode | undefined): void {
  for (const binding of patternBindingNames(pattern)) scope.bindings.add(binding.name);
}

function nearestFunctionScope(scope: Scope): Scope {
  let candidate = scope;
  while (candidate.kind !== 'function' && candidate.kind !== 'program' && candidate.parent) {
    candidate = candidate.parent;
  }
  return candidate;
}

function buildScopes(program: LocatedNode): Map<LocatedNode, Scope> {
  const scopes = new Map<LocatedNode, Scope>();
  const root: Scope = { kind: 'program', bindings: new Set() };

  function visit(node: LocatedNode, scope: Scope): void {
    scopes.set(node, scope);

    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
      const id = node.id as LocatedNode | undefined;
      if (id?.type === 'Identifier') scope.bindings.add(String(id.name));
    }

    if (
      node.type === 'FunctionDeclaration'
      || node.type === 'FunctionExpression'
      || node.type === 'ArrowFunctionExpression'
    ) {
      const functionScope: Scope = { parent: scope, kind: 'function', bindings: new Set() };
      const id = node.id as LocatedNode | undefined;
      if (id?.type === 'Identifier') functionScope.bindings.add(String(id.name));
      for (const parameter of node.params as LocatedNode[]) addPattern(functionScope, parameter);
      for (const parameter of node.params as LocatedNode[]) visit(parameter, functionScope);
      visit(node.body as LocatedNode, functionScope);
      return;
    }

    if (node.type === 'ClassExpression' || node.type === 'ClassDeclaration') {
      const classScope: Scope = { parent: scope, kind: 'class', bindings: new Set() };
      const id = node.id as LocatedNode | undefined;
      if (id?.type === 'Identifier') classScope.bindings.add(String(id.name));
      const superClass = node.superClass as LocatedNode | undefined;
      if (superClass) visit(superClass, scope);
      visit(node.body as LocatedNode, classScope);
      return;
    }

    if (node.type === 'BlockStatement') {
      const blockScope: Scope = { parent: scope, kind: 'block', bindings: new Set() };
      for (const statement of node.body as LocatedNode[]) visit(statement, blockScope);
      return;
    }

    if (node.type === 'CatchClause') {
      const catchScope: Scope = { parent: scope, kind: 'catch', bindings: new Set() };
      addPattern(catchScope, node.param as LocatedNode | undefined);
      if (node.param) visit(node.param as LocatedNode, catchScope);
      visit(node.body as LocatedNode, catchScope);
      return;
    }

    if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers as LocatedNode[]) {
        const local = specifier.local as LocatedNode;
        if (local?.type === 'Identifier') scope.bindings.add(String(local.name));
      }
    } else if (node.type === 'VariableDeclaration') {
      const declarationScope = node.kind === 'var' ? nearestFunctionScope(scope) : scope;
      for (const declaration of node.declarations as LocatedNode[]) {
        addPattern(declarationScope, declaration.id as LocatedNode);
      }
    }

    for (const child of childNodes(node)) visit(child, scope);
  }

  visit(program, root);
  return scopes;
}

function isBound(scope: Scope | undefined, name: string): boolean {
  if (recognizedMacroGlobals.has(name)) return true;
  let current = scope;
  while (current) {
    if (current.bindings.has(name)) return true;
    current = current.parent;
  }
  return false;
}

function observationId(kind: string, file: MacroFile, range: SourceRange, suffix = ''): string {
  return `obs-${stableHash(`${kind}:${file.id}:${range.start.line}:${range.start.column}:${range.end.line}:${range.end.column}:${suffix}`)}`;
}

export function unresolvedIdentifierObservations(
  parsed: ParsedFile,
  contentHash: string,
): UnresolvedIdentifierObservation[] {
  const scopeByNode = buildScopes(parsed.program);
  const observations: UnresolvedIdentifierObservation[] = [];

  function walk(node: LocatedNode, parent: LocatedNode | undefined, ancestors: LocatedNode[]): void {
    if (
      node.type === 'Identifier'
      && isIdentifierUse(node, parent, ancestors)
      && !isBound(scopeByNode.get(node), String(node.name))
    ) {
      const range = sourceRange(node);
      observations.push({
        id: observationId('unresolved-identifier', parsed.file, range, String(node.name)),
        family: 'lexical-scope',
        kind: 'unresolved-identifier',
        identifier: String(node.name),
        sourceReference: sourceReference(parsed.file, contentHash, range),
      });
    }
    for (const child of childNodes(node)) walk(child, node, [...ancestors, node]);
  }
  walk(parsed.program, undefined, []);
  return observations;
}

interface VocabularyEntry {
  category: string;
  canonicalTerm: string;
  components: string[];
}

const vocabulary: VocabularyEntry[] = [
  ['password', ['password']], ['password', ['passwd']], ['password', ['pwd']],
  ['password', ['passphrase']], ['password', ['pin']],
  ['credential', ['credential']], ['credential', ['credentials']],
  ['login', ['username']], ['login', ['user', 'name']], ['login', ['login']],
  ['token', ['access', 'token']], ['token', ['refresh', 'token']],
  ['token', ['identity', 'token']], ['token', ['session', 'token']],
  ['token', ['auth', 'token']], ['token', ['bearer', 'token']],
  ['token', ['sas', 'token']], ['token', ['jwt']], ['token', ['pat']], ['token', ['token']],
  ['secret', ['client', 'secret']], ['secret', ['app', 'secret']],
  ['secret', ['consumer', 'secret']], ['secret', ['webhook', 'secret']], ['secret', ['secret']],
  ['key', ['api', 'key']], ['key', ['access', 'key']], ['key', ['secret', 'key']],
  ['key', ['private', 'key']], ['key', ['signing', 'key']], ['key', ['encryption', 'key']],
  ['key', ['ssh', 'key']], ['key', ['hmac', 'key']], ['key', ['aes', 'key']],
  ['authorization', ['proxy', 'authorization']], ['authorization', ['authorization']],
  ['authorization', ['authentication']], ['authorization', ['basic', 'auth']],
  ['authorization', ['proxy', 'auth']], ['authorization', ['basic']], ['authorization', ['proxy']],
  ['header', ['proxy', 'authorization', 'header']], ['header', ['authorization', 'header']],
  ['header', ['set', 'cookie']], ['header', ['cookie', 'header']], ['header', ['cookie']],
  ['session', ['session', 'identifier']], ['session', ['session', 'id']],
  ['database', ['database', 'url']], ['database', ['connection', 'string']],
  ['identity', ['service', 'account']], ['key', ['private', 'key', 'marker']],
].map(([category, components]) => ({
  category: category as string,
  canonicalTerm: (components as string[]).join(' '),
  components: components as string[],
})).sort((left, right) => right.components.length - left.components.length);

interface WordComponent {
  value: string;
  start: number;
  end: number;
}

function wordComponents(value: string): WordComponent[] {
  const components: WordComponent[] = [];
  const wordPattern = /[A-Za-z0-9]+/g;
  for (const wordMatch of value.matchAll(wordPattern)) {
    const word = wordMatch[0];
    const wordStart = wordMatch.index;
    const camelPattern = /[A-Z]+(?=[A-Z][a-z]|\d|\b)|[A-Z]?[a-z]+|[0-9]+/g;
    const camelMatches = [...word.matchAll(camelPattern)];
    if (camelMatches.length === 0) {
      components.push({ value: word.toLowerCase(), start: wordStart, end: wordStart + word.length });
      continue;
    }
    for (const match of camelMatches) {
      components.push({
        value: match[0].toLowerCase(),
        start: wordStart + match.index,
        end: wordStart + match.index + match[0].length,
      });
    }
  }
  return components;
}

function scanCredentialTerms(value: string): Array<{
  entry: VocabularyEntry;
  submittedTerm: string;
  start: number;
  end: number;
}> {
  const components = wordComponents(value);
  const matches: Array<{
    entry: VocabularyEntry;
    submittedTerm: string;
    start: number;
    end: number;
  }> = [];
  for (let index = 0; index < components.length;) {
    const entry = vocabulary.find((candidate) =>
      candidate.components.every((component, offset) =>
        components[index + offset]?.value === component));
    if (!entry) {
      index += 1;
      continue;
    }
    const first = components[index];
    const last = components[index + entry.components.length - 1];
    if (!first || !last) {
      index += 1;
      continue;
    }
    matches.push({
      entry,
      submittedTerm: value.slice(first.start, last.end),
      start: first.start,
      end: last.end,
    });
    index += entry.components.length;
  }
  return matches;
}

export function credentialIndicatorObservations(
  file: MacroFile,
  contentHash: string,
): CredentialIndicatorObservation[] {
  const observations: CredentialIndicatorObservation[] = [];
  for (const match of scanCredentialTerms(file.source)) {
    const range = {
      start: positionAt(file.source, match.start),
      end: positionAt(file.source, match.end),
    };
    observations.push({
      id: observationId('credential-indicator', file, range, `${match.entry.canonicalTerm}:${match.start}`),
      family: 'credential-indicators',
      kind: 'credential-indicator',
      category: match.entry.category,
      canonicalTerm: match.entry.canonicalTerm,
      submittedTerm: match.submittedTerm,
      location: 'source',
      sourceReference: sourceReference(file, contentHash, range),
    });
  }
  for (const match of scanCredentialTerms(file.path)) {
    const range = { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } };
    observations.push({
      id: observationId('credential-indicator-filename', file, range, `${match.entry.canonicalTerm}:${match.start}`),
      family: 'credential-indicators',
      kind: 'credential-indicator',
      category: match.entry.category,
      canonicalTerm: match.entry.canonicalTerm,
      submittedTerm: match.submittedTerm,
      location: 'filename',
      sourceReference: sourceReference(file, contentHash, range),
    });
  }
  return observations;
}

function positionAt(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

export function commonJsObservations(
  parsed: ParsedFile,
  contentHash: string,
): CommonJsObservation[] {
  return parsed.commonJsOccurrences.map((occurrence) => ({
    id: observationId('commonjs-syntax', parsed.file, occurrence.range, occurrence.form),
    family: 'module-syntax',
    kind: 'commonjs-syntax',
    form: occurrence.form,
    sourceReference: sourceReference(parsed.file, contentHash, occurrence.range),
  }));
}
