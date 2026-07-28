import { parse } from 'acorn';
import type { Node } from 'acorn';
import type { ApiKind, ApiOperation, MacroFile, SourcePosition, SourceRange } from '../types';

export interface LocatedNode extends Node {
  start: number;
  end: number;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  [key: string]: unknown;
}

export interface ParsedComment {
  value: string;
  range: SourceRange;
  start: number;
  end: number;
}

export interface StaticModuleReference {
  kind: 'import' | 'export' | 'require';
  specifier: string;
  range: SourceRange;
  node: LocatedNode;
}

export interface CommonJsOccurrence {
  form: 'require' | 'module-member' | 'exports-member' | '__filename' | '__dirname';
  range: SourceRange;
  node: LocatedNode;
}

export interface StaticExternalUrl {
  domain: string;
  protocol: string;
  xmlPayload: boolean;
  range: SourceRange;
  node: LocatedNode;
}

export interface ParsedFile {
  file: MacroFile;
  program: LocatedNode;
  moduleReferences: StaticModuleReference[];
  localImports: StaticModuleReference[];
  dynamicImports: Array<{ range: SourceRange; node: LocatedNode }>;
  externalUrls: StaticExternalUrl[];
  dynamicExternalUrls: Array<{ range: SourceRange; node: LocatedNode; xmlPayload: boolean }>;
  commonJsOccurrences: CommonJsOccurrence[];
  comments: ParsedComment[];
}

/**
 * Internal schema-matching input. Literal values are deliberately confined to
 * the pure analysis process and are never copied into the Analysis Report.
 */
export interface ExtractedReference {
  kind: ApiKind;
  path: string;
  operation: ApiOperation;
  syntax: 'modern' | 'legacy';
  range: SourceRange;
  literalArguments: Record<string, unknown>;
  knownArgumentNames: string[];
  argumentCoverage: 'complete' | 'partial' | 'dynamic';
  literalValue?: unknown;
}

export type ParseResult =
  | { kind: 'parsed'; parsed: ParsedFile }
  | { kind: 'parse-error'; message: string; range?: SourceRange };

export function sourceRange(node: LocatedNode): SourceRange {
  return {
    start: {
      line: node.loc?.start.line ?? 1,
      column: (node.loc?.start.column ?? 0) + 1,
    },
    end: {
      line: node.loc?.end.line ?? 1,
      column: (node.loc?.end.column ?? 0) + 1,
    },
  };
}

export function sourcePositionAt(source: string, offset: number): SourcePosition {
  let line = 1;
  let lineStart = 0;
  const bounded = Math.max(0, Math.min(offset, source.length));
  for (let index = 0; index < bounded; index += 1) {
    if (source.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: bounded - lineStart + 1 };
}

export function sourceRangeAt(source: string, start: number, end: number): SourceRange {
  return {
    start: sourcePositionAt(source, start),
    end: sourcePositionAt(source, end),
  };
}

export function staticString(node: LocatedNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral') {
    const expressions = node.expressions as LocatedNode[];
    const quasis = node.quasis as Array<{ value: { cooked?: string } }>;
    if (expressions.length === 0) return quasis[0]?.value.cooked ?? '';
  }
  return undefined;
}

export function staticPrimitive(node: LocatedNode | undefined): unknown {
  if (!node) return undefined;
  if (node.type === 'Literal') return node.value;
  if (node.type === 'TemplateLiteral' && (node.expressions as LocatedNode[]).length === 0) {
    return (node.quasis as Array<{ value: { cooked?: string } }>)[0]?.value.cooked ?? '';
  }
  if (node.type === 'UnaryExpression' && node.operator === '-' && (node.argument as LocatedNode).type === 'Literal') {
    const value = (node.argument as LocatedNode).value;
    return typeof value === 'number' ? -value : undefined;
  }
  return undefined;
}

export function isXmlPayloadString(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith('<')) return false;
  const withoutDeclaration = trimmed.replace(/^<\?xml\b[^?]*\?>\s*/i, '');
  const root = /^<([A-Za-z_][\w:.-]*)(?:\s[^<>]*?)?(\/?)>/.exec(withoutDeclaration);
  if (!root) return false;
  if (root[2] === '/') return true;
  const rootName = root[1]?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Boolean(rootName && new RegExp(`</${rootName}\\s*>\\s*$`, 'i').test(withoutDeclaration));
}

export function childNodes(node: LocatedNode): LocatedNode[] {
  const children: LocatedNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && typeof (item as { type?: unknown }).type === 'string') {
          children.push(item as LocatedNode);
        }
      }
    } else if (value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string') {
      children.push(value as LocatedNode);
    }
  }
  return children;
}

export function walkAst(
  root: LocatedNode,
  visit: (node: LocatedNode, parent?: LocatedNode, ancestors?: LocatedNode[]) => void,
): void {
  function walk(node: LocatedNode, parent: LocatedNode | undefined, ancestors: LocatedNode[]): void {
    visit(node, parent, ancestors);
    for (const child of childNodes(node)) walk(child, node, [...ancestors, node]);
  }
  walk(root, undefined, []);
}

export function patternBindingNames(pattern: LocatedNode | undefined): Array<{ name: string; node: LocatedNode }> {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [{ name: String(pattern.name), node: pattern }];
  if (pattern.type === 'RestElement') return patternBindingNames(pattern.argument as LocatedNode);
  if (pattern.type === 'AssignmentPattern') return patternBindingNames(pattern.left as LocatedNode);
  if (pattern.type === 'ArrayPattern') {
    return (pattern.elements as Array<LocatedNode | null>).flatMap((element) =>
      element ? patternBindingNames(element) : []);
  }
  if (pattern.type === 'ObjectPattern') {
    return (pattern.properties as LocatedNode[]).flatMap((property) => {
      if (property.type === 'RestElement') return patternBindingNames(property.argument as LocatedNode);
      return patternBindingNames(property.value as LocatedNode);
    });
  }
  return [];
}

function propertyName(node: LocatedNode): string | undefined {
  if (node.type === 'Identifier') return String(node.name);
  return staticString(node);
}

function isModuleMember(node: LocatedNode): boolean {
  if (node.type !== 'MemberExpression') return false;
  const object = node.object as LocatedNode;
  return object.type === 'Identifier' && object.name === 'module';
}

function isExportsMember(node: LocatedNode): boolean {
  if (node.type !== 'MemberExpression') return false;
  const object = node.object as LocatedNode;
  return object.type === 'Identifier' && object.name === 'exports';
}

export function memberStaticName(node: LocatedNode): string | undefined {
  if (node.type !== 'MemberExpression') return undefined;
  const property = node.property as LocatedNode;
  return node.computed ? staticString(property) : propertyName(property);
}

/**
 * Determines whether an Identifier is a value use rather than syntax such as a
 * declaration name, a non-computed property key, or a label.
 */
export function isIdentifierUse(
  node: LocatedNode,
  parent: LocatedNode | undefined,
  ancestors: LocatedNode[] = [],
): boolean {
  if (node.type !== 'Identifier' || !parent) return false;
  if (
    (parent.type === 'VariableDeclarator' && parent.id === node)
    || ((parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression' || parent.type === 'ClassDeclaration' || parent.type === 'ClassExpression') && parent.id === node)
    || ((parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression' || parent.type === 'ArrowFunctionExpression') && (parent.params as LocatedNode[]).some((parameter) => parameter === node))
    || (parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier' || parent.type === 'ImportNamespaceSpecifier')
    || (parent.type === 'ExportSpecifier')
    || (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement')
    || (parent.type === 'CatchClause' && parent.param === node)
  ) return false;

  if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return false;
  if (parent.type === 'Property' && parent.key === node && !parent.computed) {
    // Object shorthand `{ value }` is both a key and a value use.
    return parent.shorthand === true && parent.value === node;
  }
  if (parent.type === 'MethodDefinition' && parent.key === node && !parent.computed) return false;
  if (parent.type === 'PropertyDefinition' && parent.key === node && !parent.computed) return false;
  if (parent.type === 'MetaProperty') return false;

  // Identifiers nested inside binding patterns are declarations, including
  // object destructuring properties whose direct parent is a Property.
  const bindingOwner = [...ancestors].reverse().find((ancestor) =>
    ancestor.type === 'VariableDeclarator'
    || ancestor.type === 'FunctionDeclaration'
    || ancestor.type === 'FunctionExpression'
    || ancestor.type === 'ArrowFunctionExpression'
    || ancestor.type === 'CatchClause');
  if (bindingOwner) {
    const bindingRoots: LocatedNode[] = bindingOwner.type === 'VariableDeclarator'
      ? [bindingOwner.id as LocatedNode]
      : bindingOwner.type === 'CatchClause'
        ? [bindingOwner.param as LocatedNode]
        : bindingOwner.params as LocatedNode[];
    if (bindingRoots.some((root) => root && node.start >= root.start && node.end <= root.end)) return false;
  }
  return true;
}

export function parseMacroFile(file: MacroFile): ParseResult {
  const comments: ParsedComment[] = [];
  let program: LocatedNode;
  try {
    program = parse(file.source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
      allowHashBang: true,
      onComment: (
        _isBlock: boolean,
        value: string,
        start: number,
        end: number,
        startLoc?: { line: number; column: number },
        endLoc?: { line: number; column: number },
      ) => {
        comments.push({
          value,
          start,
          end,
          range: {
            start: {
              line: startLoc?.line ?? sourcePositionAt(file.source, start).line,
              column: (startLoc?.column ?? sourcePositionAt(file.source, start).column - 1) + 1,
            },
            end: {
              line: endLoc?.line ?? sourcePositionAt(file.source, end).line,
              column: (endLoc?.column ?? sourcePositionAt(file.source, end).column - 1) + 1,
            },
          },
        });
      },
    }) as unknown as LocatedNode;
  } catch (error) {
    const parseError = error as Error & { loc?: { line: number; column: number } };
    const position = parseError.loc
      ? { line: parseError.loc.line, column: parseError.loc.column + 1 }
      : undefined;
    return {
      kind: 'parse-error',
      message: parseError.message,
      range: position ? { start: position, end: position } : undefined,
    };
  }

  const moduleReferences: StaticModuleReference[] = [];
  const dynamicImports: Array<{ range: SourceRange; node: LocatedNode }> = [];
  const externalUrls: StaticExternalUrl[] = [];
  const dynamicExternalUrls: Array<{ range: SourceRange; node: LocatedNode; xmlPayload: boolean }> = [];
  const commonJsOccurrences: CommonJsOccurrence[] = [];
  const commonJsKeys = new Set<string>();
  const externalUrlKeys = new Set<string>();
  const absoluteUrlPattern = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>]+/gi;

  function addExternalUrls(value: string, node: LocatedNode, xmlPayload: boolean): void {
    for (const match of value.matchAll(absoluteUrlPattern)) {
      const candidate = match[0];
      try {
        const authority = candidate.slice(candidate.indexOf('://') + 3).split(/[/?#]/, 1)[0] ?? '';
        if (authority.includes('__DYNAMIC_VALUE__')) continue;
        const url = new URL(candidate);
        const protocol = url.protocol.slice(0, -1).toLowerCase();
        if (!url.hostname || !protocol) continue;
        const domain = url.hostname.toLowerCase().replace(/\.$/, '');
        const key = `${node.start}:${domain}:${protocol}`;
        if (externalUrlKeys.has(key)) continue;
        externalUrlKeys.add(key);
        externalUrls.push({
          domain,
          protocol,
          xmlPayload,
          range: sourceRange(node),
          node,
        });
      } catch {
        // A URL-looking string without a parseable host is not a static domain.
      }
    }
  }

  function addCommonJs(form: CommonJsOccurrence['form'], node: LocatedNode): void {
    const key = `${form}:${node.start}:${node.end}`;
    if (commonJsKeys.has(key)) return;
    commonJsKeys.add(key);
    commonJsOccurrences.push({ form, range: sourceRange(node), node });
  }

  walkAst(program, (node, parent, ancestors) => {
    if (node.type === 'Literal' && typeof node.value === 'string') {
      addExternalUrls(node.value, node, isXmlPayloadString(node.value));
    } else if (node.type === 'TemplateLiteral') {
      const quasis = node.quasis as Array<LocatedNode & { value: { cooked?: string; raw?: string } }>;
      const combined = quasis.map((quasi, index) => {
        const value = quasi.value.cooked ?? quasi.value.raw ?? '';
        return index < quasis.length - 1 ? `${value}__DYNAMIC_VALUE__` : value;
      }).join('');
      const xmlPayload = isXmlPayloadString(combined);
      addExternalUrls(combined, node, xmlPayload);
      const leadingText = quasis[0]?.value.cooked ?? quasis[0]?.value.raw ?? '';
      if (
        (node.expressions as LocatedNode[]).length > 0
        && /^\s*[a-z][a-z0-9+.-]*:\/\/\s*$/i.test(leadingText)
      ) {
        dynamicExternalUrls.push({ range: sourceRange(node), node, xmlPayload });
      }
    }

    if (node.type === 'ImportDeclaration') {
      const specifier = staticString(node.source as LocatedNode);
      if (specifier !== undefined) {
        moduleReferences.push({ kind: 'import', specifier, range: sourceRange(node), node });
      }
      return;
    }
    if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
      const specifier = staticString(node.source as LocatedNode | undefined);
      if (specifier !== undefined) {
        moduleReferences.push({ kind: 'export', specifier, range: sourceRange(node), node });
      }
      return;
    }
    if (node.type === 'ImportExpression') {
      dynamicImports.push({ range: sourceRange(node), node });
      return;
    }
    if (node.type === 'CallExpression') {
      const callee = node.callee as LocatedNode;
      if (callee.type === 'Identifier' && callee.name === 'require') {
        addCommonJs('require', node);
        const specifier = staticString((node.arguments as LocatedNode[])[0]);
        if (specifier !== undefined) {
          moduleReferences.push({ kind: 'require', specifier, range: sourceRange(node), node });
        } else {
          dynamicImports.push({ range: sourceRange(node), node });
        }
      }
      return;
    }
    if (isModuleMember(node)) addCommonJs('module-member', node);
    else if (isExportsMember(node)) addCommonJs('exports-member', node);
    else if (node.type === 'Identifier' && isIdentifierUse(node, parent, ancestors)) {
      if (node.name === '__filename') addCommonJs('__filename', node);
      if (node.name === '__dirname') addCommonJs('__dirname', node);
    }
  });

  moduleReferences.sort((left, right) => left.node.start - right.node.start);
  commonJsOccurrences.sort((left, right) => left.node.start - right.node.start);

  return {
    kind: 'parsed',
    parsed: {
      file,
      program,
      moduleReferences,
      localImports: moduleReferences.filter((reference) => reference.specifier.startsWith('.')),
      dynamicImports,
      externalUrls,
      dynamicExternalUrls,
      commonJsOccurrences,
      comments,
    },
  };
}
