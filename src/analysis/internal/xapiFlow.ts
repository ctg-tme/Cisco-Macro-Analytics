import type {
  ApiAvailability,
  ApiKind,
  ApiOperation,
  ArgumentPositionShape,
  ArgumentPropertyShape,
  ArgumentShape,
  CanonicalXapiReference,
  SourceReference,
  XapiBindingFlowObservation,
  XapiBindingRoute,
  XapiBindingRouteHop,
  XapiFlowFrontierObservation,
  XapiRootBindingObservation,
  XapiTouchpointObservation,
} from '../types';
import type { GraphResult } from './importGraph';
import {
  childNodes,
  isXmlPayloadString,
  memberStaticName,
  patternBindingNames,
  sourceRange,
  staticPrimitive,
  staticString,
  type ExtractedReference,
  type LocatedNode,
  type ParsedFile,
} from './parser';
import { sourceReference, stableHash } from './reportSupport';

interface XapiAtom {
  segments: string[];
  dynamic: boolean;
  routes: XapiBindingRoute[];
}

interface XapiValue {
  type: 'xapi';
  atoms: XapiAtom[];
  mixed: boolean;
}

interface FunctionValue {
  type: 'function';
  id: string;
  name: string;
  node: LocatedNode;
  file: ParsedFile;
  closure: Environment;
  boundThis?: ObjectValue;
}

interface ObjectValue {
  type: 'object';
  id: string;
  properties: Map<string, FlowValue>;
}

interface ClassValue {
  type: 'class';
  id: string;
  name: string;
  file: ParsedFile;
  closure: Environment;
  constructor?: FunctionValue;
  methods: Map<string, FunctionValue>;
  fields: Array<{ name?: string; computed: boolean; value?: LocatedNode; node: LocatedNode }>;
}

interface PrimitiveValue {
  type: 'primitive';
  value: unknown;
  origins: FlowValueOrigin[];
}

interface ArrayValue {
  type: 'array';
  items: FlowValue[];
}

interface ExportReferenceValue {
  type: 'export-reference';
  module: ModuleRuntime;
  exportName: string;
  importNode: LocatedNode;
  importerFile: ParsedFile;
  localName: string;
}

interface UnknownValue {
  type: 'unknown';
}

interface NonXapiValue {
  type: 'non-xapi';
}

type FlowValue =
  | XapiValue
  | FunctionValue
  | ObjectValue
  | ClassValue
  | PrimitiveValue
  | ArrayValue
  | ExportReferenceValue
  | UnknownValue
  | NonXapiValue;

const UNKNOWN: UnknownValue = { type: 'unknown' };
const NON_XAPI: NonXapiValue = { type: 'non-xapi' };

class Environment {
  readonly bindings = new Map<string, FlowValue>();

  constructor(readonly parent?: Environment) {}

  get(name: string): FlowValue {
    if (this.bindings.has(name)) return this.bindings.get(name) ?? UNKNOWN;
    return this.parent?.get(name) ?? UNKNOWN;
  }

  declare(name: string, value: FlowValue): void {
    this.bindings.set(name, value);
  }

  assign(name: string, value: FlowValue): void {
    if (this.bindings.has(name) || !this.parent) {
      this.bindings.set(name, value);
      return;
    }
    this.parent.assign(name, value);
  }

  clone(): Environment {
    const clone = new Environment(this.parent);
    for (const [name, value] of this.bindings) clone.bindings.set(name, value);
    return clone;
  }
}

interface ModuleRuntime {
  file: ParsedFile;
  environment: Environment;
  exports: Map<string, FlowValue>;
  status: 'new' | 'evaluating' | 'evaluated';
}

export interface FlowTouchpoint {
  observation: XapiTouchpointObservation;
  extractedReference: ExtractedReference;
}

export interface FlowValueOrigin {
  fileId: string;
  start: number;
  end: number;
}

export interface XapiArgumentUse {
  fileId: string;
  argumentRanges: Array<{ start: number; end: number }>;
  valueOrigins: FlowValueOrigin[];
}

export interface XapiFlowAnalysis {
  rootBindings: XapiRootBindingObservation[];
  bindingFlows: XapiBindingFlowObservation[];
  frontiers: XapiFlowFrontierObservation[];
  touchpoints: FlowTouchpoint[];
  argumentUses: XapiArgumentUse[];
  xmlPayloadValueOrigins: FlowValueOrigin[];
}

interface EvalContext {
  file: ParsedFile;
  environment: Environment;
  module: ModuleRuntime;
  thisValue?: ObjectValue;
  callDepth: number;
}

interface StatementResult {
  returned?: FlowValue;
}

function routeKey(route: XapiBindingRoute): string {
  return route.hops.map((hop) =>
    `${hop.sourceReference.fileId}:${hop.sourceReference.range.start.line}:${hop.sourceReference.range.start.column}:${hop.transformation}:${hop.bindingName}`,
  ).join('>');
}

function uniqueRoutes(routes: XapiBindingRoute[]): XapiBindingRoute[] {
  return [...new Map(routes.map((route) => [routeKey(route), route])).values()];
}

function uniqueOrigins(origins: FlowValueOrigin[]): FlowValueOrigin[] {
  return [...new Map(origins.map((origin) => [
    `${origin.fileId}:${origin.start}:${origin.end}`,
    origin,
  ])).values()];
}

function valueOrigins(valueInput: FlowValue, seen = new Set<FlowValue>()): FlowValueOrigin[] {
  const value = resolvedValue(valueInput);
  if (seen.has(value)) return [];
  seen.add(value);
  if (value.type === 'primitive') return value.origins;
  if (value.type === 'array') {
    return uniqueOrigins(value.items.flatMap((item) => valueOrigins(item, seen)));
  }
  if (value.type === 'object') {
    return uniqueOrigins([...value.properties.values()].flatMap((item) => valueOrigins(item, seen)));
  }
  return [];
}

function normalizedAtoms(atoms: XapiAtom[]): XapiAtom[] {
  const groups = new Map<string, XapiAtom>();
  for (const atom of atoms) {
    const key = `${atom.dynamic}:${atom.segments.join('.')}`;
    const existing = groups.get(key);
    if (existing) existing.routes = uniqueRoutes([...existing.routes, ...atom.routes]);
    else groups.set(key, { ...atom, routes: uniqueRoutes(atom.routes) });
  }
  return [...groups.values()];
}

function xapiValue(atoms: XapiAtom[], mixed = false): XapiValue {
  return { type: 'xapi', atoms: normalizedAtoms(atoms), mixed };
}

function resolvedValue(value: FlowValue, seen = new Set<FlowValue>()): FlowValue {
  if (value.type !== 'export-reference' || seen.has(value)) return value;
  seen.add(value);
  const exported = value.module.exports.get(value.exportName) ?? UNKNOWN;
  const resolved = resolvedValue(exported, seen);
  if (resolved.type !== 'xapi') return resolved;
  const crossing = value.importerFile.file.id !== value.module.file.file.id
    ? {
        fromFileId: value.module.file.file.id,
        toFileId: value.importerFile.file.id,
      }
    : undefined;
  const reference = sourceReference(
    value.importerFile.file,
    hashes.get(value.importerFile.file.id) ?? '',
    sourceRange(value.importNode),
  );
  const atoms = resolved.atoms.map((atom) => ({
    ...atom,
    routes: atom.routes.map((route) => ({
      hops: [...route.hops, {
        bindingName: value.localName,
        transformation: 'import' as const,
        sourceReference: reference,
        ...(crossing ? { dependencyCrossing: crossing } : {}),
      }],
    })),
  }));
  return xapiValue(atoms, resolved.mixed);
}

function mergeValues(leftValue: FlowValue, rightValue: FlowValue): FlowValue {
  const left = resolvedValue(leftValue);
  const right = resolvedValue(rightValue);
  if (left === right) return left;
  if (left.type === 'xapi' && right.type === 'xapi') {
    const pathKeys = new Set([...left.atoms, ...right.atoms].map((atom) =>
      `${atom.dynamic}:${atom.segments.join('.')}`));
    return xapiValue([...left.atoms, ...right.atoms], left.mixed || right.mixed || pathKeys.size > 1);
  }
  if (left.type === 'xapi') return xapiValue(left.atoms, true);
  if (right.type === 'xapi') return xapiValue(right.atoms, true);
  if (left.type === 'primitive' && right.type === 'primitive') {
    return {
      type: 'primitive',
      value: left.value === right.value ? left.value : undefined,
      origins: uniqueOrigins([...left.origins, ...right.origins]),
    };
  }
  return UNKNOWN;
}

function cloneAndMergeEnvironment(target: Environment, left: Environment, right: Environment): void {
  const names = new Set([...target.bindings.keys(), ...left.bindings.keys(), ...right.bindings.keys()]);
  for (const name of names) {
    target.bindings.set(name, mergeValues(left.get(name), right.get(name)));
  }
}

function firstBindingName(node: LocatedNode): string {
  if (node.type === 'Identifier') return String(node.name);
  if (node.type === 'ThisExpression') return 'this';
  if (node.type === 'MemberExpression') {
    const object = node.object as LocatedNode;
    const property = memberStaticName(node);
    const root = firstBindingName(object);
    return property ? `${root}.${property}` : root;
  }
  return '<expression>';
}

function pathIdentity(reference: CanonicalXapiReference): string {
  return `${reference.kind}|${reference.normalizedPathSegments.join(' ')}|${reference.operation}|${reference.complete}`;
}

function preferredExpression(
  kind: ApiKind,
  pathSegments: string[],
  operation: ApiOperation,
): string {
  const kindName = kind === 'Configuration' ? 'Config' : kind;
  const root = `xapi.${kindName}.${pathSegments.join('.')}`;
  if (kind === 'Command') return `${root}(…)`;
  if (operation === 'subscribe') return `${root}.on(…)`;
  if (operation === 'set') return `${root}.set(…)`;
  return `${root}.get()`;
}

function documentationUrl(kind: ApiKind, pathSegments: string[]): string {
  return `https://roomos.cisco.com/xapi/${kind}.${pathSegments.join('.')}/`;
}

function detectableType(node: LocatedNode | undefined): string {
  if (!node) return 'undefined';
  if (node.type === 'Literal') {
    if (node.value === null) return 'null';
    return typeof node.value;
  }
  if (node.type === 'TemplateLiteral') return 'string';
  if (node.type === 'ObjectExpression') return 'object';
  if (node.type === 'ArrayExpression') return 'array';
  if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') return 'function';
  if (node.type === 'NewExpression') return 'object';
  return 'unknown';
}

function containerForm(node: LocatedNode | undefined): string {
  if (!node) return 'missing';
  const forms: Record<string, string> = {
    ObjectExpression: 'object',
    ArrayExpression: 'array',
    Literal: 'primitive',
    TemplateLiteral: 'template',
    Identifier: 'binding',
    CallExpression: 'call-result',
    NewExpression: 'constructed-object',
    FunctionExpression: 'function',
    ArrowFunctionExpression: 'function',
    SpreadElement: 'spread',
  };
  return forms[node.type] ?? 'expression';
}

function isStaticValue(node: LocatedNode | undefined): boolean {
  if (!node) return false;
  if (node.type === 'Literal') return true;
  if (node.type === 'TemplateLiteral') return (node.expressions as LocatedNode[]).length === 0;
  if (node.type === 'ArrayExpression') {
    return (node.elements as Array<LocatedNode | null>).every((element) => !element || isStaticValue(element));
  }
  if (node.type === 'ObjectExpression') {
    return (node.properties as LocatedNode[]).every((property) =>
      property.type === 'Property'
      && !property.computed
      && isStaticValue(property.value as LocatedNode));
  }
  return false;
}

function propertyShapes(node: LocatedNode): ArgumentPropertyShape[] | undefined {
  if (node.type !== 'ObjectExpression') return undefined;
  const shapes: ArgumentPropertyShape[] = [];
  for (const property of node.properties as LocatedNode[]) {
    if (property.type !== 'Property' || property.computed) continue;
    const key = property.key as LocatedNode;
    const name = key.type === 'Identifier' ? String(key.name) : staticString(key);
    if (!name) continue;
    const value = property.value as LocatedNode;
    shapes.push({
      name,
      detectableValueType: detectableType(value),
      valueForm: isStaticValue(value) ? 'static' : 'dynamic',
      containerForm: containerForm(value),
    });
  }
  return shapes;
}

function argumentShape(argumentsList: LocatedNode[]): ArgumentShape {
  const positions: ArgumentPositionShape[] = argumentsList.map((argument, position) => {
    const properties = propertyShapes(argument);
    return {
      position,
      containerForm: containerForm(argument),
      detectableValueType: detectableType(argument),
      valueForm: isStaticValue(argument) ? 'static' : 'dynamic',
      propertyNames: properties?.map((property) => property.name) ?? [],
      ...(properties && properties.length > 0 ? { properties } : {}),
    };
  });
  return { argumentCount: argumentsList.length, positions };
}

function literalObject(node: LocatedNode | undefined): {
  values: Record<string, unknown>;
  knownNames: string[];
  coverage: 'complete' | 'partial' | 'dynamic';
} {
  if (!node) return { values: {}, knownNames: [], coverage: 'complete' };
  if (node.type !== 'ObjectExpression') return { values: {}, knownNames: [], coverage: 'dynamic' };
  const values: Record<string, unknown> = {};
  const knownNames: string[] = [];
  let coverage: 'complete' | 'partial' = 'complete';
  for (const property of node.properties as LocatedNode[]) {
    if (property.type !== 'Property' || property.computed) {
      coverage = 'partial';
      continue;
    }
    const key = property.key as LocatedNode;
    const name = key.type === 'Identifier' ? String(key.name) : staticString(key);
    if (name) knownNames.push(name);
    const value = staticPrimitive(property.value as LocatedNode);
    if (name && value !== undefined) values[name] = value;
  }
  return { values, knownNames, coverage };
}

function stringPrefix(node: LocatedNode | undefined): { segments: string[]; complete: boolean } {
  const complete = staticString(node);
  if (complete !== undefined) {
    return { segments: complete.trim().split(/\s+/).filter(Boolean), complete: true };
  }
  if (node?.type === 'TemplateLiteral') {
    const first = (node.quasis as Array<{ value: { cooked?: string } }>)[0]?.value.cooked ?? '';
    return { segments: first.trim().split(/\s+/).filter(Boolean), complete: false };
  }
  return { segments: [], complete: false };
}

let hashes = new Map<string, string>();

export function analyzeXapiFlow(
  graph: GraphResult,
  contentHashes: Map<string, string>,
): XapiFlowAnalysis {
  hashes = contentHashes;
  const reachableIds = new Set(graph.reachable.map((file) => file.id));
  const parsedFiles = [...graph.parsedById.values()].filter((parsed) => reachableIds.has(parsed.file.id));
  const modules = new Map<string, ModuleRuntime>();
  const rootBindings = new Map<string, XapiRootBindingObservation>();
  const bindingFlows = new Map<string, XapiBindingFlowObservation>();
  const frontiers = new Map<string, XapiFlowFrontierObservation>();
  const touchpoints = new Map<string, FlowTouchpoint>();
  const argumentUses = new Map<string, XapiArgumentUse>();
  const xmlPayloadValueOrigins = new Map<string, FlowValueOrigin>();
  const functions = new Map<string, FunctionValue>();
  const activeCalls = new Set<string>();

  const dependencyByReference = new Map<string, string>();
  for (const edge of graph.directEdges) {
    dependencyByReference.set(`${edge.importer.id}:${edge.reference.node.start}`, edge.dependency.id);
  }

  function reference(file: ParsedFile, node: LocatedNode): SourceReference {
    return sourceReference(file.file, contentHashes.get(file.file.id) ?? '', sourceRange(node));
  }

  function addRouteHop(
    value: XapiValue,
    file: ParsedFile,
    node: LocatedNode,
    bindingName: string,
    transformation: XapiBindingRouteHop['transformation'],
    crossing?: XapiBindingRouteHop['dependencyCrossing'],
  ): XapiValue {
    const hop: XapiBindingRouteHop = {
      bindingName,
      transformation,
      sourceReference: reference(file, node),
      ...(crossing ? { dependencyCrossing: crossing } : {}),
    };
    const next = xapiValue(value.atoms.map((atom) => ({
      ...atom,
      routes: atom.routes.map((route) => ({ hops: [...route.hops, hop] })),
    })), value.mixed);
    if (transformation !== 'touchpoint') {
      for (const atom of next.atoms) {
        for (const route of atom.routes) {
          const id = `obs-${stableHash(`xapi-flow:${routeKey(route)}`)}`;
          bindingFlows.set(id, {
            id,
            family: 'xapi-bindings',
            kind: 'xapi-binding-flow',
            bindingName,
            transformation,
            route,
            sourceReference: hop.sourceReference,
          });
        }
      }
    }
    return next;
  }

  function seed(
    file: ParsedFile,
    node: LocatedNode,
    bindingName: string,
    origin: XapiRootBindingObservation['origin'],
    segments: string[] = [],
  ): XapiValue {
    const hop: XapiBindingRouteHop = {
      bindingName,
      transformation: origin === 'commonjs-require' ? 'commonjs-origin' : origin === 're-export' ? 're-export' : 'module-origin',
      sourceReference: reference(file, node),
    };
    const route = { hops: [hop] };
    const value = xapiValue([{ segments, dynamic: false, routes: [route] }]);
    if (segments.length === 0) {
      const id = `obs-${stableHash(`xapi-root:${file.file.id}:${node.start}:${bindingName}:${origin}`)}`;
      rootBindings.set(id, {
        id,
        family: 'xapi-bindings',
        kind: 'xapi-root-binding',
        bindingName,
        origin,
        conventionalName: bindingName === 'xapi',
        route,
        sourceReference: hop.sourceReference,
      });
    }
    return value;
  }

  function addFrontier(
    value: XapiValue,
    context: EvalContext,
    node: LocatedNode,
    frontierType: XapiFlowFrontierObservation['frontierType'],
    knownPrefix: string[],
  ): void {
    const id = `obs-${stableHash(`xapi-frontier:${context.file.file.id}:${node.start}:${node.end}:${frontierType}`)}`;
    const routes = uniqueRoutes(value.atoms.flatMap((atom) => atom.routes));
    const existing = frontiers.get(id);
    if (existing) {
      existing.routes = uniqueRoutes([...existing.routes, ...routes]);
      return;
    }
    frontiers.set(id, {
      id,
      family: 'xapi-bindings',
      kind: 'xapi-flow-frontier',
      frontierType,
      knownPathPrefix: knownPrefix,
      routes,
      sourceReference: reference(context.file, node),
      limitations: [
        'The route is proven only to this boundary; returned or downstream values are not attributed to xAPI.',
      ],
    });
  }

  function modernReference(atom: XapiAtom): {
    canonical: CanonicalXapiReference;
    syntax: 'modern';
  } | undefined {
    const [root, ...rest] = atom.segments;
    const kind: ApiKind | undefined = root === 'Command'
      ? 'Command'
      : root === 'Config'
        ? 'Configuration'
        : root === 'Status'
          ? 'Status'
          : root === 'Event'
            ? 'Event'
            : undefined;
    if (!kind) return undefined;
    let operation: ApiOperation;
    let pathSegments: string[];
    if (kind === 'Command') {
      operation = 'execute';
      pathSegments = rest;
    } else {
      const method = rest.at(-1);
      operation = method === 'set'
        ? 'set'
        : method === 'on' || method === 'once'
          ? 'subscribe'
          : method === 'get'
            ? 'get'
            : 'get';
      if (!['get', 'set', 'on', 'once'].includes(method ?? '')) return undefined;
      pathSegments = rest.slice(0, -1);
    }
    if (pathSegments.length === 0 && !atom.dynamic) return undefined;
    const complete = !atom.dynamic;
    return {
      syntax: 'modern',
      canonical: {
        kind,
        normalizedPathSegments: pathSegments,
        operation,
        complete,
        ...(complete ? {
          preferredNewStyleExpression: preferredExpression(kind, pathSegments, operation),
          documentationUrl: documentationUrl(kind, pathSegments),
        } : {
          limitation: 'A computed path segment prevents complete canonical reconstruction.',
        }),
      },
    };
  }

  function legacyReference(atom: XapiAtom, argumentsList: LocatedNode[]): {
    canonical: CanonicalXapiReference;
    syntax: 'legacy';
  } | undefined {
    const [root, method] = atom.segments;
    const kind: ApiKind | undefined = root === 'command'
      ? 'Command'
      : root === 'config'
        ? 'Configuration'
        : root === 'status'
          ? 'Status'
          : root === 'event'
            ? 'Event'
            : undefined;
    if (!kind) return undefined;
    const operation: ApiOperation | undefined = kind === 'Command'
      ? 'execute'
      : method === 'set'
        ? 'set'
        : method === 'get'
          ? 'get'
          : method === 'on' || method === 'once'
            ? 'subscribe'
            : undefined;
    if (!operation) return undefined;
    const path = stringPrefix(argumentsList[0]);
    return {
      syntax: 'legacy',
      canonical: {
        kind,
        normalizedPathSegments: path.segments,
        operation,
        complete: path.complete,
        ...(path.complete && path.segments.length > 0 ? {
          preferredNewStyleExpression: preferredExpression(kind, path.segments, operation),
          documentationUrl: documentationUrl(kind, path.segments),
        } : {
          limitation: 'The old-style path is dynamic, so only its known prefix is retained.',
        }),
      },
    };
  }

  function internalReference(
    canonical: CanonicalXapiReference,
    syntax: 'modern' | 'legacy',
    node: LocatedNode,
    argumentsList: LocatedNode[],
  ): ExtractedReference {
    const path = canonical.normalizedPathSegments.join(' ');
    const commandArgument = canonical.kind === 'Command'
      ? argumentsList[syntax === 'modern' ? 0 : 1]
      : undefined;
    const commandArguments = literalObject(commandArgument);
    const configValueNode = canonical.kind === 'Configuration' && canonical.operation === 'set'
      ? argumentsList[syntax === 'modern' ? 0 : 1]
      : undefined;
    const configValue = staticPrimitive(configValueNode);
    return {
      kind: canonical.kind,
      path,
      operation: canonical.operation,
      syntax,
      range: sourceRange(node),
      literalArguments: commandArguments.values,
      knownArgumentNames: commandArguments.knownNames,
      argumentCoverage: commandArgument
        ? commandArguments.coverage
        : configValueNode && configValue === undefined
          ? 'dynamic'
          : 'complete',
      ...(configValue !== undefined ? { literalValue: configValue } : {}),
    };
  }

  function recordTouchpoint(
    value: XapiValue,
    context: EvalContext,
    node: LocatedNode,
    calleeNode: LocatedNode,
    argumentsList: LocatedNode[],
    argumentValues: FlowValue[],
  ): boolean {
    const resolvedAtoms = value.atoms.map((atom) => ({
      atom,
      reference: legacyReference(atom, argumentsList) ?? modernReference(atom),
    })).filter((item): item is {
      atom: XapiAtom;
      reference: NonNullable<ReturnType<typeof modernReference>>;
    } => Boolean(item.reference));
    if (resolvedAtoms.length === 0) return false;

    const argumentUseKey = `${context.file.file.id}:${node.start}:${node.end}`;
    const existingArgumentUse = argumentUses.get(argumentUseKey);
    const nextRanges = argumentsList.map((argument) => ({
      start: argument.start,
      end: argument.end,
    }));
    const nextOrigins = uniqueOrigins(argumentValues.flatMap((argument) => valueOrigins(argument)));
    argumentUses.set(argumentUseKey, {
      fileId: context.file.file.id,
      argumentRanges: [...new Map([
        ...(existingArgumentUse?.argumentRanges ?? []),
        ...nextRanges,
      ].map((range) => [`${range.start}:${range.end}`, range])).values()],
      valueOrigins: uniqueOrigins([
        ...(existingArgumentUse?.valueOrigins ?? []),
        ...nextOrigins,
      ]),
    });

    const identities = new Set(resolvedAtoms.map((item) => pathIdentity(item.reference.canonical)));
    const knownPrefix = resolvedAtoms[0]?.reference.canonical.normalizedPathSegments ?? [];
    if (value.mixed || identities.size > 1) {
      addFrontier(value, context, node, 'mixed-flow', knownPrefix);
      return true;
    }

    const selected = resolvedAtoms[0];
    if (!selected) return false;
    const canonical = selected.reference.canonical;
    const routes = uniqueRoutes(resolvedAtoms.flatMap(({ atom }) =>
      atom.routes.map((route) => ({
        hops: [...route.hops, {
          bindingName: firstBindingName(calleeNode),
          transformation: 'touchpoint' as const,
          sourceReference: reference(context.file, node),
        }],
      }))));
    if (!canonical.complete) {
      addFrontier(value, context, node, 'computed-path', canonical.normalizedPathSegments);
    }

    const identity = `${context.file.file.id}:${node.start}:${node.end}:${pathIdentity(canonical)}`;
    const id = `obs-${stableHash(`xapi-touchpoint:${identity}`)}`;
    const existing = touchpoints.get(identity);
    if (existing) {
      existing.observation.bindingRoutes = uniqueRoutes([
        ...existing.observation.bindingRoutes,
        ...routes,
      ]);
      return true;
    }
    const observation: XapiTouchpointObservation = {
      id,
      family: 'xapi-touchpoints',
      kind: 'xapi-touchpoint',
      submittedSyntax: selected.reference.syntax === 'modern' ? 'new-style' : 'old-style',
      canonicalReference: canonical,
      argumentShape: argumentShape(argumentsList),
      bindingRoutes: routes,
      availability: 'unknown-in-exploratory-analysis' as ApiAvailability,
      sourceReference: reference(context.file, node),
      ...(!canonical.complete ? {
        limitations: [canonical.limitation ?? 'The complete xAPI path could not be reconstructed.'],
      } : {}),
    };
    touchpoints.set(identity, {
      observation,
      extractedReference: internalReference(canonical, selected.reference.syntax, node, argumentsList),
    });
    return true;
  }

  function makeFunction(
    node: LocatedNode,
    file: ParsedFile,
    closure: Environment,
    name?: string,
  ): FunctionValue {
    const id = `${file.file.id}:${node.start}:${node.end}`;
    const existing = functions.get(id);
    if (existing) return existing;
    const value: FunctionValue = {
      type: 'function',
      id,
      name: name ?? (node.id as LocatedNode | undefined)?.name as string | undefined ?? '<anonymous>',
      node,
      file,
      closure,
    };
    functions.set(id, value);
    return value;
  }

  function makeClass(node: LocatedNode, file: ParsedFile, closure: Environment, name?: string): ClassValue {
    const methods = new Map<string, FunctionValue>();
    const fields: ClassValue['fields'] = [];
    let constructorValue: FunctionValue | undefined;
    for (const element of (node.body as LocatedNode).body as LocatedNode[]) {
      if (element.type === 'MethodDefinition') {
        const methodName = memberStaticName({
          ...element,
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'class', start: element.start, end: element.start },
          property: element.key,
        } as unknown as LocatedNode);
        if (!methodName) continue;
        const method = makeFunction(element.value as LocatedNode, file, closure, methodName);
        if (element.kind === 'constructor') constructorValue = method;
        else methods.set(methodName, method);
      } else if (element.type === 'PropertyDefinition') {
        const key = element.key as LocatedNode;
        fields.push({
          name: element.computed ? staticString(key) : key.type === 'Identifier' ? String(key.name) : staticString(key),
          computed: Boolean(element.computed),
          value: element.value as LocatedNode | undefined,
          node: element,
        });
      }
    }
    return {
      type: 'class',
      id: `${file.file.id}:${node.start}:${node.end}`,
      name: name ?? (node.id as LocatedNode | undefined)?.name as string | undefined ?? '<anonymous-class>',
      file,
      closure,
      ...(constructorValue ? { constructor: constructorValue } : {}),
      methods,
      fields,
    };
  }

  function addBindingValue(
    environment: Environment,
    pattern: LocatedNode,
    initial: FlowValue,
    context: EvalContext,
    transformation: XapiBindingRouteHop['transformation'],
  ): void {
    const value = resolvedValue(initial);
    if (pattern.type === 'Identifier') {
      const name = String(pattern.name);
      environment.declare(
        name,
        value.type === 'xapi'
          ? addRouteHop(value, context.file, pattern, name, transformation)
          : value,
      );
      return;
    }
    if (pattern.type === 'AssignmentPattern') {
      addBindingValue(environment, pattern.left as LocatedNode, value, context, transformation);
      return;
    }
    if (pattern.type === 'RestElement') {
      addBindingValue(environment, pattern.argument as LocatedNode, UNKNOWN, context, transformation);
      return;
    }
    if (pattern.type === 'ObjectPattern') {
      for (const property of pattern.properties as LocatedNode[]) {
        if (property.type === 'RestElement') {
          addBindingValue(environment, property.argument as LocatedNode, UNKNOWN, context, transformation);
          continue;
        }
        const key = property.key as LocatedNode;
        const propertyName = property.computed
          ? staticString(key)
          : key.type === 'Identifier' ? String(key.name) : staticString(key);
        let propertyValue: FlowValue = UNKNOWN;
        if (value.type === 'xapi' && propertyName) {
          propertyValue = xapiValue(value.atoms.map((atom) => ({
            ...atom,
            segments: [...atom.segments, propertyName],
          })), value.mixed);
        } else if (value.type === 'object' && propertyName) {
          propertyValue = value.properties.get(propertyName) ?? UNKNOWN;
        }
        addBindingValue(environment, property.value as LocatedNode, propertyValue, context, 'destructure');
      }
      return;
    }
    if (pattern.type === 'ArrayPattern') {
      const items = value.type === 'array' ? value.items : [];
      for (const [index, element] of (pattern.elements as Array<LocatedNode | null>).entries()) {
        if (element) {
          addBindingValue(environment, element, items[index] ?? UNKNOWN, context, 'destructure');
        }
      }
    }
  }

  function assignMember(
    member: LocatedNode,
    valueInput: FlowValue,
    context: EvalContext,
  ): void {
    const object = resolvedValue(evaluateExpression(member.object as LocatedNode, context));
    const property = memberStaticName(member);
    const value = resolvedValue(valueInput);
    if (!property) {
      if (value.type === 'xapi') addFrontier(value, context, member, 'dynamic-transformation', []);
      return;
    }
    if (object.type !== 'object') {
      if (value.type === 'xapi') addFrontier(value, context, member, 'opaque-call', []);
      return;
    }
    object.properties.set(
      property,
      value.type === 'xapi'
        ? addRouteHop(
            value,
            context.file,
            member,
            `${firstBindingName(member.object as LocatedNode)}.${property}`,
            (member.object as LocatedNode).type === 'ThisExpression' ? 'instance-property' : 'object-property',
          )
        : value,
    );
  }

  function evaluateExpression(node: LocatedNode | undefined, context: EvalContext): FlowValue {
    if (!node) return NON_XAPI;
    switch (node.type) {
      case 'Identifier':
        return resolvedValue(context.environment.get(String(node.name)));
      case 'ThisExpression':
        return context.thisValue ?? NON_XAPI;
      case 'Literal':
        return {
          type: 'primitive',
          value: node.value,
          origins: [{ fileId: context.file.file.id, start: node.start, end: node.end }],
        };
      case 'TemplateLiteral':
        {
          const expressions = (node.expressions as LocatedNode[]).map((expression) =>
            evaluateExpression(expression, context));
          const quasis = node.quasis as Array<{ value: { cooked?: string; raw?: string } }>;
          const combined = quasis.map((quasi, index) => {
            const value = quasi.value.cooked ?? quasi.value.raw ?? '';
            return index < quasis.length - 1 ? `${value}__DYNAMIC_VALUE__` : value;
          }).join('');
          const expressionOrigins = uniqueOrigins(expressions.flatMap((value) => valueOrigins(value)));
          if (isXmlPayloadString(combined)) {
            for (const origin of expressionOrigins) {
              xmlPayloadValueOrigins.set(`${origin.fileId}:${origin.start}:${origin.end}`, origin);
            }
          }
          return {
            type: 'primitive',
            value: staticString(node),
            origins: uniqueOrigins([
              { fileId: context.file.file.id, start: node.start, end: node.end },
              ...expressionOrigins,
            ]),
          };
        }
      case 'AwaitExpression':
      case 'ChainExpression':
        return evaluateExpression((node.argument ?? node.expression) as LocatedNode, context);
      case 'SequenceExpression': {
        let value: FlowValue = NON_XAPI;
        for (const expression of node.expressions as LocatedNode[]) value = evaluateExpression(expression, context);
        return value;
      }
      case 'ConditionalExpression': {
        const condition = evaluateExpression(node.test as LocatedNode, context);
        if (condition.type === 'primitive' && typeof condition.value === 'boolean') {
          return evaluateExpression(
            (condition.value ? node.consequent : node.alternate) as LocatedNode,
            context,
          );
        }
        return mergeValues(
          evaluateExpression(node.consequent as LocatedNode, { ...context, environment: context.environment.clone() }),
          evaluateExpression(node.alternate as LocatedNode, { ...context, environment: context.environment.clone() }),
        );
      }
      case 'LogicalExpression':
        return mergeValues(
          evaluateExpression(node.left as LocatedNode, context),
          evaluateExpression(node.right as LocatedNode, context),
        );
      case 'AssignmentExpression': {
        const right = evaluateExpression(node.right as LocatedNode, context);
        const left = node.left as LocatedNode;
        if (left.type === 'Identifier') {
          const name = String(left.name);
          context.environment.assign(
            name,
            resolvedValue(right).type === 'xapi'
              ? addRouteHop(resolvedValue(right) as XapiValue, context.file, left, name, 'assignment')
              : right,
          );
        } else if (left.type === 'MemberExpression') assignMember(left, right, context);
        else addBindingValue(context.environment, left, right, context, 'assignment');
        return right;
      }
      case 'UpdateExpression': {
        const argument = node.argument as LocatedNode;
        if (argument.type === 'Identifier') context.environment.assign(String(argument.name), NON_XAPI);
        return NON_XAPI;
      }
      case 'MemberExpression': {
        const object = resolvedValue(evaluateExpression(node.object as LocatedNode, context));
        const property = memberStaticName(node);
        if (object.type === 'xapi') {
          if (!property) {
            return xapiValue(object.atoms.map((atom) => ({ ...atom, dynamic: true })), object.mixed);
          }
          return xapiValue(object.atoms.map((atom) => ({
            ...atom,
            segments: atom.dynamic && !['get', 'set', 'on', 'once'].includes(property)
              ? atom.segments
              : [...atom.segments, property],
          })), object.mixed);
        }
        if (object.type === 'object' && property) {
          const member = resolvedValue(object.properties.get(property) ?? UNKNOWN);
          if (member.type === 'function') return { ...member, boundThis: object };
          return member;
        }
        return UNKNOWN;
      }
      case 'ObjectExpression': {
        const object: ObjectValue = {
          type: 'object',
          id: `${context.file.file.id}:object:${node.start}`,
          properties: new Map(),
        };
        for (const property of node.properties as LocatedNode[]) {
          if (property.type === 'SpreadElement') {
            const spread = resolvedValue(evaluateExpression(property.argument as LocatedNode, context));
            if (spread.type === 'object') {
              for (const [name, value] of spread.properties) object.properties.set(name, value);
            } else if (spread.type === 'xapi') {
              addFrontier(spread, context, property, 'dynamic-transformation', []);
            }
            continue;
          }
          if (property.type !== 'Property') continue;
          const keyNode = property.key as LocatedNode;
          const key = property.computed
            ? staticString(keyNode)
            : keyNode.type === 'Identifier' ? String(keyNode.name) : staticString(keyNode);
          const rawValue = property.method
            ? makeFunction(property.value as LocatedNode, context.file, context.environment, key)
            : evaluateExpression(property.value as LocatedNode, context);
          if (!key) {
            const resolved = resolvedValue(rawValue);
            if (resolved.type === 'xapi') addFrontier(resolved, context, property, 'dynamic-transformation', []);
            continue;
          }
          object.properties.set(
            key,
            resolvedValue(rawValue).type === 'xapi'
              ? addRouteHop(resolvedValue(rawValue) as XapiValue, context.file, property, key, 'object-property')
              : rawValue,
          );
        }
        return object;
      }
      case 'ArrayExpression': {
        const items: FlowValue[] = [];
        for (const element of node.elements as Array<LocatedNode | null>) {
          const value = element ? resolvedValue(evaluateExpression(element, context)) : NON_XAPI;
          if (element && value.type === 'xapi') {
            addFrontier(value, context, element, 'dynamic-transformation', []);
          }
          items.push(value);
        }
        return { type: 'array', items };
      }
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        return makeFunction(node, context.file, context.environment);
      case 'ClassExpression':
        return makeClass(node, context.file, context.environment);
      case 'CallExpression': {
        const calleeNode = node.callee as LocatedNode;
        const argumentNodes = node.arguments as LocatedNode[];
        const evaluateArguments = () => argumentNodes.map((argument) =>
          argument.type === 'SpreadElement'
            ? evaluateExpression(argument.argument as LocatedNode, context)
            : evaluateExpression(argument, context));
        if (
          calleeNode.type === 'Identifier'
          && calleeNode.name === 'String'
          && resolvedValue(context.environment.get('String')).type === 'unknown'
        ) {
          const argumentValues = evaluateArguments();
          const value = resolvedValue(argumentValues[0] ?? NON_XAPI);
          return {
            type: 'primitive',
            value: value.type === 'primitive' && value.value !== undefined
              ? String(value.value)
              : undefined,
            origins: valueOrigins(value),
          };
        }
        if (
          calleeNode.type === 'MemberExpression'
          && ['trim', 'trimStart', 'trimEnd', 'toLowerCase', 'toUpperCase', 'normalize']
            .includes(memberStaticName(calleeNode) ?? '')
        ) {
          const receiver = resolvedValue(evaluateExpression(calleeNode.object as LocatedNode, context));
          evaluateArguments();
          if (receiver.type === 'primitive') {
            return {
              type: 'primitive',
              value: undefined,
              origins: valueOrigins(receiver),
            };
          }
        }
        const callee = resolvedValue(evaluateExpression(calleeNode, context));
        const argumentValues = evaluateArguments();
        if (callee.type === 'xapi') {
          if (recordTouchpoint(callee, context, node, calleeNode, argumentNodes, argumentValues)) {
            return NON_XAPI;
          }
          if (callee.mixed || callee.atoms.some((atom) => atom.dynamic)) {
            addFrontier(callee, context, node, callee.mixed ? 'mixed-flow' : 'computed-path', []);
          }
          return NON_XAPI;
        }
        if (callee.type === 'function') {
          return callFunction(
            callee,
            argumentValues,
            context,
            callee.boundThis ? 'method-argument-to-parameter' : 'argument-to-parameter',
          );
        }
        for (const argument of argumentValues.map((value) => resolvedValue(value))) {
          if (argument.type === 'xapi') addFrontier(argument, context, node, 'opaque-call', []);
        }
        return UNKNOWN;
      }
      case 'NewExpression': {
        const constructor = resolvedValue(evaluateExpression(node.callee as LocatedNode, context));
        const argumentNodes = node.arguments as LocatedNode[];
        const argumentsList = argumentNodes.map((argument) => evaluateExpression(argument, context));
        if (constructor.type === 'class') {
          const instance: ObjectValue = {
            type: 'object',
            id: `${constructor.id}:instance:${node.start}`,
            properties: new Map(),
          };
          for (const [name, method] of constructor.methods) {
            instance.properties.set(name, { ...method, boundThis: instance });
          }
          const classContext: EvalContext = {
            ...context,
            file: constructor.file,
            environment: constructor.closure,
            thisValue: instance,
          };
          for (const field of constructor.fields) {
            if (!field.name) continue;
            const fieldValue = field.value ? evaluateExpression(field.value, classContext) : NON_XAPI;
            instance.properties.set(field.name, fieldValue);
          }
          if (constructor.constructor) {
            callFunction(
              { ...constructor.constructor, boundThis: instance },
              argumentsList,
              context,
              'constructor-argument-to-parameter',
            );
          }
          return instance;
        }
        if (constructor.type === 'function') {
          const instance: ObjectValue = {
            type: 'object',
            id: `${constructor.id}:instance:${node.start}`,
            properties: new Map(),
          };
          callFunction(
            { ...constructor, boundThis: instance },
            argumentsList,
            context,
            'constructor-argument-to-parameter',
          );
          return instance;
        }
        for (const argument of argumentsList.map((value) => resolvedValue(value))) {
          if (argument.type === 'xapi') addFrontier(argument, context, node, 'opaque-call', []);
        }
        return UNKNOWN;
      }
      case 'UnaryExpression':
      case 'BinaryExpression':
        for (const child of childNodes(node)) evaluateExpression(child, context);
        return NON_XAPI;
      default:
        for (const child of childNodes(node)) evaluateExpression(child, context);
        return NON_XAPI;
    }
  }

  function callFunction(
    callable: FunctionValue,
    argumentsList: FlowValue[],
    callerContext: EvalContext,
    transformation: 'argument-to-parameter' | 'method-argument-to-parameter' | 'constructor-argument-to-parameter',
  ): FlowValue {
    if (callerContext.callDepth >= 12) {
      for (const argument of argumentsList.map((value) => resolvedValue(value))) {
        if (argument.type === 'xapi') addFrontier(argument, callerContext, callable.node, 'opaque-call', []);
      }
      return UNKNOWN;
    }
    const signature = argumentsList.map((argument) => {
      const resolved = resolvedValue(argument);
      return resolved.type === 'xapi'
        ? `${resolved.mixed}:${resolved.atoms.map((atom) => atom.segments.join('.')).join(',')}`
        : resolved.type;
    }).join('|');
    const callKey = `${callable.id}:${signature}:${callable.boundThis?.id ?? ''}`;
    if (activeCalls.has(callKey)) return UNKNOWN;
    activeCalls.add(callKey);
    try {
      const environment = new Environment(callable.closure);
      const context: EvalContext = {
        file: callable.file,
        environment,
        module: modules.get(callable.file.file.id) ?? callerContext.module,
        ...(callable.boundThis ? { thisValue: callable.boundThis } : {}),
        callDepth: callerContext.callDepth + 1,
      };
      const params = callable.node.params as LocatedNode[];
      for (let index = 0; index < params.length; index += 1) {
        const parameter = params[index];
        if (!parameter) continue;
        const argument = resolvedValue(argumentsList[index] ?? UNKNOWN);
        const crossing = callable.file.file.id !== callerContext.file.file.id && argument.type === 'xapi'
          ? {
              fromFileId: callerContext.file.file.id,
              toFileId: callable.file.file.id,
            }
          : undefined;
        if (argument.type === 'xapi' && crossing) {
          const withCrossing = xapiValue(argument.atoms.map((atom) => ({
            ...atom,
            routes: atom.routes.map((route) => ({
              hops: route.hops.map((hop, hopIndex) =>
                hopIndex === route.hops.length - 1 ? { ...hop, dependencyCrossing: crossing } : hop),
            })),
          })), argument.mixed);
          addBindingValue(environment, parameter, withCrossing, context, transformation);
        } else {
          addBindingValue(environment, parameter, argument, context, transformation);
        }
      }
      const body = callable.node.body as LocatedNode;
      if (body.type !== 'BlockStatement') {
        const returned = resolvedValue(evaluateExpression(body, context));
        return returned.type === 'xapi'
          ? addRouteHop(returned, callable.file, body, callable.name, 'return')
          : returned;
      }
      return evaluateStatements(body.body as LocatedNode[], context).returned ?? NON_XAPI;
    } finally {
      activeCalls.delete(callKey);
    }
  }

  function evaluateStatement(node: LocatedNode, context: EvalContext): StatementResult {
    switch (node.type) {
      case 'VariableDeclaration':
        for (const declaration of node.declarations as LocatedNode[]) {
          const value = evaluateExpression(declaration.init as LocatedNode | undefined, context);
          addBindingValue(context.environment, declaration.id as LocatedNode, value, context, 'alias');
        }
        return {};
      case 'FunctionDeclaration': {
        const id = node.id as LocatedNode;
        if (id?.type === 'Identifier') {
          context.environment.declare(
            String(id.name),
            makeFunction(node, context.file, context.environment, String(id.name)),
          );
        }
        return {};
      }
      case 'ClassDeclaration': {
        const id = node.id as LocatedNode;
        if (id?.type === 'Identifier') {
          context.environment.declare(
            String(id.name),
            makeClass(node, context.file, context.environment, String(id.name)),
          );
        }
        return {};
      }
      case 'ExpressionStatement':
        evaluateExpression(node.expression as LocatedNode, context);
        return {};
      case 'ReturnStatement': {
        const returned = resolvedValue(evaluateExpression(node.argument as LocatedNode | undefined, context));
        return {
          returned: returned.type === 'xapi' && node.argument
            ? addRouteHop(returned, context.file, node.argument as LocatedNode, '<return>', 'return')
            : returned,
        };
      }
      case 'ThrowStatement':
        evaluateExpression(node.argument as LocatedNode, context);
        return {};
      case 'BlockStatement':
        return evaluateStatements(node.body as LocatedNode[], {
          ...context,
          environment: new Environment(context.environment),
        });
      case 'IfStatement': {
        const test = evaluateExpression(node.test as LocatedNode, context);
        if (test.type === 'primitive' && typeof test.value === 'boolean') {
          const selectedBranch = test.value ? node.consequent : node.alternate;
          return selectedBranch
            ? evaluateStatement(selectedBranch as LocatedNode, context)
            : {};
        }
        const consequentEnvironment = context.environment.clone();
        const alternateEnvironment = context.environment.clone();
        const consequent = evaluateStatement(node.consequent as LocatedNode, {
          ...context,
          environment: consequentEnvironment,
        });
        const alternate = node.alternate
          ? evaluateStatement(node.alternate as LocatedNode, {
              ...context,
              environment: alternateEnvironment,
            })
          : {};
        cloneAndMergeEnvironment(context.environment, consequentEnvironment, alternateEnvironment);
        if (consequent.returned && alternate.returned) {
          return { returned: mergeValues(consequent.returned, alternate.returned) };
        }
        return {};
      }
      case 'ForStatement':
        if (node.init) {
          const initial = node.init as LocatedNode;
          if (initial.type === 'VariableDeclaration') evaluateStatement(initial, context);
          else evaluateExpression(initial, context);
        }
        if (node.test) evaluateExpression(node.test as LocatedNode, context);
        if (node.body) evaluateStatement(node.body as LocatedNode, context);
        if (node.update) evaluateExpression(node.update as LocatedNode, context);
        return {};
      case 'ForInStatement':
      case 'ForOfStatement':
        evaluateExpression(node.right as LocatedNode, context);
        if ((node.left as LocatedNode).type === 'VariableDeclaration') {
          evaluateStatement(node.left as LocatedNode, context);
        }
        evaluateStatement(node.body as LocatedNode, context);
        return {};
      case 'WhileStatement':
      case 'DoWhileStatement':
        evaluateExpression(node.test as LocatedNode, context);
        evaluateStatement(node.body as LocatedNode, context);
        return {};
      case 'TryStatement': {
        evaluateStatement(node.block as LocatedNode, context);
        if (node.handler) evaluateStatement((node.handler as LocatedNode).body as LocatedNode, context);
        if (node.finalizer) evaluateStatement(node.finalizer as LocatedNode, context);
        return {};
      }
      case 'SwitchStatement':
        evaluateExpression(node.discriminant as LocatedNode, context);
        for (const switchCase of node.cases as LocatedNode[]) {
          if (switchCase.test) evaluateExpression(switchCase.test as LocatedNode, context);
          evaluateStatements(switchCase.consequent as LocatedNode[], context);
        }
        return {};
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration':
        if (node.declaration) {
          const declaration = node.declaration as LocatedNode;
          if (declaration.type.endsWith('Declaration')) evaluateStatement(declaration, context);
          else evaluateExpression(declaration, context);
        }
        return {};
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'EmptyStatement':
      case 'DebuggerStatement':
        return {};
      default:
        for (const child of childNodes(node)) {
          if (child.type.endsWith('Statement') || child.type.endsWith('Declaration')) evaluateStatement(child, context);
          else evaluateExpression(child, context);
        }
        return {};
    }
  }

  function evaluateStatements(statements: LocatedNode[], context: EvalContext): StatementResult {
    for (const statement of statements) {
      const result = evaluateStatement(statement, context);
      if (result.returned) return result;
    }
    return {};
  }

  function moduleFor(file: ParsedFile): ModuleRuntime {
    let runtime = modules.get(file.file.id);
    if (runtime) return runtime;
    runtime = {
      file,
      environment: new Environment(),
      exports: new Map(),
      status: 'new',
    };
    modules.set(file.file.id, runtime);
    return runtime;
  }

  function localDependency(fileId: string, node: LocatedNode): ModuleRuntime | undefined {
    const dependencyId = dependencyByReference.get(`${fileId}:${node.start}`);
    const dependency = dependencyId ? graph.parsedById.get(dependencyId) : undefined;
    return dependency ? evaluateModule(dependency) : undefined;
  }

  function processImport(node: LocatedNode, runtime: ModuleRuntime): void {
    const specifier = staticString(node.source as LocatedNode);
    if (!specifier) return;
    if (specifier === 'xapi') {
      for (const imported of node.specifiers as LocatedNode[]) {
        const local = imported.local as LocatedNode;
        const localName = String(local.name);
        const importedName = imported.type === 'ImportSpecifier'
          ? String((imported.imported as LocatedNode).name ?? staticString(imported.imported as LocatedNode) ?? '')
          : '';
        runtime.environment.declare(
          localName,
          seed(
            runtime.file,
            node,
            localName,
            'esm-import',
            imported.type === 'ImportSpecifier' && importedName && importedName !== 'default'
              ? [importedName]
              : [],
          ),
        );
      }
      return;
    }
    if (!specifier.startsWith('.')) return;
    const dependency = localDependency(runtime.file.file.id, node);
    if (!dependency) return;
    for (const imported of node.specifiers as LocatedNode[]) {
      const local = imported.local as LocatedNode;
      const localName = String(local.name);
      if (imported.type === 'ImportNamespaceSpecifier') {
        const namespace: ObjectValue = {
          type: 'object',
          id: `${dependency.file.file.id}:namespace`,
          properties: dependency.exports,
        };
        runtime.environment.declare(localName, namespace);
      } else {
        const importedName = imported.type === 'ImportDefaultSpecifier'
          ? 'default'
          : String((imported.imported as LocatedNode).name ?? staticString(imported.imported as LocatedNode) ?? '');
        runtime.environment.declare(localName, {
          type: 'export-reference',
          module: dependency,
          exportName: importedName,
          importNode: node,
          importerFile: runtime.file,
          localName,
        });
      }
    }
  }

  function updateExports(statement: LocatedNode, runtime: ModuleRuntime): void {
    if (statement.type === 'ExportDefaultDeclaration') {
      const declaration = statement.declaration as LocatedNode;
      if (declaration.type === 'FunctionDeclaration') {
        const name = (declaration.id as LocatedNode | undefined)?.name as string | undefined;
        const value = name ? runtime.environment.get(name) : makeFunction(declaration, runtime.file, runtime.environment, 'default');
        runtime.exports.set('default', value);
      } else if (declaration.type === 'ClassDeclaration') {
        const name = (declaration.id as LocatedNode | undefined)?.name as string | undefined;
        const value = name ? runtime.environment.get(name) : makeClass(declaration, runtime.file, runtime.environment, 'default');
        runtime.exports.set('default', value);
      } else {
        runtime.exports.set('default', evaluateExpression(declaration, {
          file: runtime.file,
          environment: runtime.environment,
          module: runtime,
          callDepth: 0,
        }));
      }
      return;
    }
    if (statement.type === 'ExportNamedDeclaration') {
      const source = staticString(statement.source as LocatedNode | undefined);
      if (source === 'xapi') {
        for (const specifier of statement.specifiers as LocatedNode[]) {
          const local = specifier.local as LocatedNode;
          const exported = specifier.exported as LocatedNode;
          const exportName = String(exported.name ?? staticString(exported) ?? 'default');
          const importedName = String(local?.name ?? staticString(local) ?? 'default');
          runtime.exports.set(
            exportName,
            seed(
              runtime.file,
              statement,
              exportName,
              're-export',
              importedName === 'default' ? [] : [importedName],
            ),
          );
        }
        return;
      }
      if (source?.startsWith('.')) {
        const dependency = localDependency(runtime.file.file.id, statement);
        if (!dependency) return;
        for (const specifier of statement.specifiers as LocatedNode[]) {
          const local = specifier.local as LocatedNode;
          const exported = specifier.exported as LocatedNode;
          const exportName = String(exported.name ?? staticString(exported) ?? '');
          const importedName = String(local.name ?? staticString(local) ?? '');
          runtime.exports.set(exportName, {
            type: 'export-reference',
            module: dependency,
            exportName: importedName,
            importNode: statement,
            importerFile: runtime.file,
            localName: exportName,
          });
        }
        return;
      }
      const declaration = statement.declaration as LocatedNode | undefined;
      if (declaration?.type === 'VariableDeclaration') {
        for (const declarator of declaration.declarations as LocatedNode[]) {
          for (const binding of patternBindingNames(declarator.id as LocatedNode)) {
            runtime.exports.set(binding.name, runtime.environment.get(binding.name));
          }
        }
      } else if (declaration?.type === 'FunctionDeclaration' || declaration?.type === 'ClassDeclaration') {
        const id = declaration.id as LocatedNode;
        if (id?.type === 'Identifier') runtime.exports.set(String(id.name), runtime.environment.get(String(id.name)));
      }
      for (const specifier of statement.specifiers as LocatedNode[]) {
        const local = specifier.local as LocatedNode;
        const exported = specifier.exported as LocatedNode;
        const localName = String(local.name ?? staticString(local) ?? '');
        const exportName = String(exported.name ?? staticString(exported) ?? '');
        runtime.exports.set(exportName, runtime.environment.get(localName));
      }
    }
    if (statement.type === 'ExportAllDeclaration') {
      const source = staticString(statement.source as LocatedNode);
      if (source === 'xapi') {
        runtime.exports.set('default', seed(runtime.file, statement, 'default', 're-export'));
      } else if (source?.startsWith('.')) {
        const dependency = localDependency(runtime.file.file.id, statement);
        if (dependency) {
          for (const [name, value] of dependency.exports) {
            if (name !== 'default') runtime.exports.set(name, value);
          }
        }
      }
    }
  }

  function evaluateModule(file: ParsedFile): ModuleRuntime {
    const runtime = moduleFor(file);
    if (runtime.status !== 'new') return runtime;
    runtime.status = 'evaluating';
    const statements = file.program.body as LocatedNode[];
    // Function and class declarations are available before ordinary top-level
    // evaluation, which also makes cycle handling conservative but useful.
    for (const statement of statements) {
      const declaration = statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
        ? statement.declaration as LocatedNode | undefined
        : statement;
      if (declaration?.type === 'FunctionDeclaration') {
        const id = declaration.id as LocatedNode | undefined;
        if (id?.type === 'Identifier') {
          runtime.environment.declare(
            String(id.name),
            makeFunction(declaration, file, runtime.environment, String(id.name)),
          );
        }
      } else if (declaration?.type === 'ClassDeclaration') {
        const id = declaration.id as LocatedNode | undefined;
        if (id?.type === 'Identifier') {
          runtime.environment.declare(
            String(id.name),
            makeClass(declaration, file, runtime.environment, String(id.name)),
          );
        }
      }
    }
    for (const statement of statements) {
      if (statement.type === 'ImportDeclaration') processImport(statement, runtime);
    }
    const context: EvalContext = {
      file,
      environment: runtime.environment,
      module: runtime,
      callDepth: 0,
    };
    for (const statement of statements) {
      evaluateStatement(statement, context);
      updateExports(statement, runtime);

      // CommonJS root imports and exports are interpreted without treating
      // their conventional identifier spelling as proof.
      if (statement.type === 'VariableDeclaration') {
        for (const declaration of statement.declarations as LocatedNode[]) {
          const init = declaration.init as LocatedNode | undefined;
          const id = declaration.id as LocatedNode;
          if (
            init?.type === 'CallExpression'
            && (init.callee as LocatedNode).type === 'Identifier'
            && (init.callee as LocatedNode).name === 'require'
            && staticString((init.arguments as LocatedNode[])[0]) === 'xapi'
          ) {
            if (id.type === 'ObjectPattern') {
              for (const property of id.properties as LocatedNode[]) {
                if (property.type !== 'Property' || property.computed) continue;
                const key = property.key as LocatedNode;
                const importedName = key.type === 'Identifier' ? String(key.name) : staticString(key);
                if (!importedName) continue;
                for (const binding of patternBindingNames(property.value as LocatedNode)) {
                  runtime.environment.assign(
                    binding.name,
                    seed(file, init, binding.name, 'commonjs-require', [importedName]),
                  );
                }
              }
            } else {
              for (const binding of patternBindingNames(id)) {
                const seeded = seed(file, init, binding.name, 'commonjs-require');
                runtime.environment.assign(binding.name, seeded);
              }
            }
          }
        }
      }
      if (statement.type === 'ExpressionStatement') {
        const expression = statement.expression as LocatedNode;
        if (expression.type === 'AssignmentExpression' && (expression.left as LocatedNode).type === 'MemberExpression') {
          const left = expression.left as LocatedNode;
          const object = left.object as LocatedNode;
          const property = memberStaticName(left);
          if (object.type === 'Identifier' && object.name === 'module' && property === 'exports') {
            const exported = evaluateExpression(expression.right as LocatedNode, context);
            runtime.exports.set('default', exported);
            if (resolvedValue(exported).type === 'object') {
              for (const [name, value] of (resolvedValue(exported) as ObjectValue).properties) {
                runtime.exports.set(name, value);
              }
            }
          } else if (object.type === 'Identifier' && object.name === 'exports' && property) {
            runtime.exports.set(property, evaluateExpression(expression.right as LocatedNode, context));
          }
        }
      }
    }
    runtime.status = 'evaluated';
    return runtime;
  }

  for (const file of parsedFiles) evaluateModule(file);

  // Analyze each function once with unknown parameters. This finds direct uses
  // of captured xAPI roots in callbacks and uncalled helpers, while parameter
  // flows remain call-site-specific because UNKNOWN never seeds xAPI.
  for (const callable of [...functions.values()]) {
    const runtime = modules.get(callable.file.file.id);
    if (!runtime) continue;
    callFunction(
      callable,
      (callable.node.params as LocatedNode[]).map(() => UNKNOWN),
      {
        file: callable.file,
        environment: callable.closure,
        module: runtime,
        callDepth: 0,
      },
      'argument-to-parameter',
    );
  }

  // One source occurrence cannot safely represent two different canonical
  // paths. Collapse such call-context ambiguity to a mixed-flow frontier.
  const byOccurrence = new Map<string, FlowTouchpoint[]>();
  for (const touchpoint of touchpoints.values()) {
    const source = touchpoint.observation.sourceReference;
    const key = `${source.fileId}:${source.range.start.line}:${source.range.start.column}:${source.range.end.line}:${source.range.end.column}`;
    const group = byOccurrence.get(key) ?? [];
    group.push(touchpoint);
    byOccurrence.set(key, group);
  }
  for (const group of byOccurrence.values()) {
    if (new Set(group.map((item) => pathIdentity(item.observation.canonicalReference))).size <= 1) continue;
    const first = group[0];
    if (!first) continue;
    for (const item of group) {
      const identity = [...touchpoints].find(([, candidate]) => candidate === item)?.[0];
      if (identity) touchpoints.delete(identity);
    }
    const id = `obs-${stableHash(`xapi-frontier:mixed-occurrence:${first.observation.sourceReference.fileId}:${first.observation.sourceReference.range.start.line}:${first.observation.sourceReference.range.start.column}`)}`;
    frontiers.set(id, {
      id,
      family: 'xapi-bindings',
      kind: 'xapi-flow-frontier',
      frontierType: 'mixed-flow',
      knownPathPrefix: [],
      routes: uniqueRoutes(group.flatMap((item) => item.observation.bindingRoutes)),
      sourceReference: first.observation.sourceReference,
      limitations: ['Different proven xAPI values may reach this source occurrence, so no canonical path is reconstructed.'],
    });
  }

  return {
    rootBindings: [...rootBindings.values()],
    bindingFlows: [...bindingFlows.values()],
    frontiers: [...frontiers.values()],
    touchpoints: [...touchpoints.values()],
    argumentUses: [...argumentUses.values()],
    xmlPayloadValueOrigins: [...xmlPayloadValueOrigins.values()],
  };
}
