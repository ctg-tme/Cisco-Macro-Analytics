import { buildImportGraph } from './internal/importGraph';
import { sourceReference, sha256, stableHash } from './internal/reportSupport';
import { matchSchema, type FindingSpec } from './internal/schemaMatcher';
import {
  commonJsObservations,
  credentialIndicatorObservations,
  CREDENTIAL_VOCABULARY_VERSION,
  RECOGNIZED_MACRO_GLOBALS_VERSION,
  unresolvedIdentifierObservations,
} from './internal/sourceFacts';
import {
  analyzeXapiFlow,
  type FlowValueOrigin,
} from './internal/xapiFlow';
import { resolveEffectiveRulePack } from './rulePack';
import type {
  AnalysisInput,
  AnalysisObservation,
  AnalysisOutcome,
  AnalysisReport,
  AnalysisRuleCode,
  ApiKind,
  ApiReference,
  CanonicalXapiReference,
  CommentedUrlObservation,
  DirectDependencyEdge,
  DynamicUrlObservation,
  EffectiveRulePack,
  ExternalDependencyObservation,
  FileInventoryEntry,
  FileObservationCoverage,
  Finding,
  FindingCategory,
  FindingImpact,
  ImportObservation,
  MacroFile,
  ObservationFamily,
  ParserDiagnosticObservation,
  ReviewPriority,
  RuleApplicability,
  SourceRange,
  UnresolvedDependencyEdge,
  UrlProvenanceRoute,
  UrlUsageExplanation,
  XapiFlowFrontierObservation,
  XapiTouchpointObservation,
} from './types';

const ANALYZER_VERSION = '2.3.0';
const PARSER_VERSION = '8.17.0';
const BUILT_IN_RULE_VERSION = '2.0.0';
const OBSERVATION_FAMILIES: ObservationFamily[] = [
  'imports',
  'external-destinations',
  'parser-diagnostics',
  'module-syntax',
  'lexical-scope',
  'credential-indicators',
  'xapi-bindings',
  'xapi-touchpoints',
];
const LIMITATIONS = [
  'Schema availability means that an xAPI path appears in pinned schema evidence; it does not establish endpoint configuration, permissions, physical interfaces, runtime state, or compatibility.',
  'Explicit Source Analysis does not execute JavaScript or claim which runtime branches execute. Dynamic object behavior, prototypes, proxies, external mutation, and unproven values remain Unknown.',
  'xAPI attribution starts only at a statically proven xapi module origin. An xAPI-looking object shape or property name never creates an origin.',
];

interface FindingInput {
  code: string;
  title: string;
  summary: string;
  category: FindingCategory;
  evidence: Finding['evidence'];
  priority: ReviewPriority;
  applicability: RuleApplicability;
  evidenceRequirements?: string[];
  observationIds: string[];
  technicalBasis: string;
  limitations: string[];
  recommendedAction: string;
  ruleId?: string;
  ruleVersion?: string;
  citation?: string;
  relatedXapiReference?: CanonicalXapiReference;
  relatedSchemaSnapshotId?: string;
  details?: Record<string, unknown>;
}

function validateInput(input: AnalysisInput): AnalysisOutcome | undefined {
  const errors: string[] = [];
  if (input.macroSet.files.length === 0) errors.push('At least one macro file is required.');
  const ids = new Set<string>();
  const normalizedPaths = new Set<string>();
  for (const file of input.macroSet.files) {
    if (!file.id || !file.path) errors.push('Every macro file needs a stable id and path.');
    if (ids.has(file.id)) errors.push(`Macro file id ${file.id} is duplicated.`);
    ids.add(file.id);
    const normalizedPath = file.path.replaceAll('\\', '/').toLowerCase();
    if (normalizedPaths.has(normalizedPath)) errors.push(`Macro path ${file.path} is duplicated.`);
    normalizedPaths.add(normalizedPath);
  }
  for (const entry of input.macroSet.entryMacroIds ?? []) {
    if (!ids.has(entry)) errors.push(`Entry macro ${entry} is not in the macro set.`);
  }
  if (errors.length > 0) {
    return {
      kind: 'analysis-failure',
      failure: {
        code: 'invalid-input',
        message: errors[0] ?? 'Invalid input.',
        details: errors,
      },
    };
  }
  if (
    !input.schemaSnapshot.id
    || !input.schemaSnapshot.upstreamUpdatedAt
    || input.schemaSnapshot.objects.length !== input.schemaSnapshot.objectCount
  ) {
    return {
      kind: 'analysis-failure',
      failure: {
        code: 'invalid-schema-snapshot',
        message: 'The schema snapshot is incomplete or its object count does not match.',
      },
    };
  }
  if (
    input.target.kind === 'declared'
    && input.target.release !== input.schemaSnapshot.release
  ) {
    return {
      kind: 'analysis-failure',
      failure: {
        code: 'invalid-schema-snapshot',
        message: `Declared release ${input.target.release} does not match schema release ${input.schemaSnapshot.release}.`,
      },
    };
  }
  return undefined;
}

function observationIdentity(
  kind: string,
  file: MacroFile,
  range: SourceRange,
  suffix = '',
): string {
  return `obs-${stableHash(`${kind}:${file.id}:${range.start.line}:${range.start.column}:${range.end.line}:${range.end.column}:${suffix}`)}`;
}

function findingIdentity(input: FindingInput): string {
  return `finding-${stableHash(JSON.stringify({
    code: input.code,
    observations: [...input.observationIds].sort(),
    details: input.details,
  }))}`;
}

function observationFiles(
  observationIds: string[],
  observationsById: Map<string, AnalysisObservation>,
): string[] {
  return [...new Set(observationIds
    .map((id) => observationsById.get(id)?.sourceReference.fileId)
    .filter((id): id is string => Boolean(id)))].sort();
}

function affectedEntries(
  fileIds: string[],
  entriesByFileId: Map<string, string[]>,
): string[] {
  return [...new Set(fileIds.flatMap((fileId) => entriesByFileId.get(fileId) ?? []))].sort();
}

function buildFinding(
  input: FindingInput,
  observationsById: Map<string, AnalysisObservation>,
  entriesByFileId: Map<string, string[]>,
  rulePackVersion: string,
): Finding {
  const sourceFileIds = observationFiles(input.observationIds, observationsById);
  return {
    id: findingIdentity(input),
    rule: {
      id: input.ruleId ?? input.code,
      version: input.ruleVersion ?? (input.ruleId?.startsWith('schema.')
        ? rulePackVersion
        : BUILT_IN_RULE_VERSION),
      applicability: input.applicability,
      evidenceRequirements: input.evidenceRequirements ?? (
        input.applicability === 'target-dependent'
          ? [
              'A statically proven xAPI Touchpoint observation.',
              'A pinned Schema Snapshot.',
              'Every Declared Target field required by this rule.',
            ]
          : ['One or more submitted-source Analysis Observations referenced by this Finding.']
      ),
    },
    code: input.code,
    title: input.title,
    summary: input.summary,
    category: input.category,
    evidence: input.evidence,
    priority: input.priority,
    observationIds: [...new Set(input.observationIds)].sort(),
    sourceFileIds,
    affectedEntryMacroIds: affectedEntries(sourceFileIds, entriesByFileId),
    technicalBasis: input.technicalBasis,
    limitations: input.limitations,
    recommendedAction: input.recommendedAction,
    ...(input.citation ? { citation: input.citation } : {}),
    ...(input.relatedXapiReference ? { relatedXapiReference: input.relatedXapiReference } : {}),
    ...(input.relatedSchemaSnapshotId ? { relatedSchemaSnapshotId: input.relatedSchemaSnapshotId } : {}),
    ...(input.details ? { details: input.details } : {}),
  };
}

function categoryForSchemaCode(code: string): FindingCategory {
  return code.startsWith('coverage.') ? 'Coverage' : 'Schema';
}

function safeSchemaDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const safe = { ...details };
  // Literal argument values stay in transient schema matching state only.
  delete safe.value;
  return safe;
}

function schemaFinding(
  spec: FindingSpec,
  observation: XapiTouchpointObservation,
  observationsById: Map<string, AnalysisObservation>,
  entriesByFileId: Map<string, string[]>,
  input: AnalysisInput,
): Finding {
  return buildFinding({
    code: spec.code,
    title: spec.title,
    summary: spec.message,
    category: categoryForSchemaCode(spec.code),
    evidence: spec.evidence,
    priority: spec.priority,
    applicability: 'target-dependent',
    observationIds: [observation.id],
    technicalBasis: spec.basis
      ?? `The conclusion compares a statically reconstructed xAPI reference with pinned schema snapshot ${input.schemaSnapshot.id}.`,
    limitations: spec.limitations
      ?? ['The pinned schema establishes documented API structure only and does not establish runtime execution or compatibility.'],
    recommendedAction: spec.recommendedAction
      ?? 'Review the canonical xAPI reference and the pinned RoomOS schema evidence for the intended deployment.',
    ruleId: spec.code,
    ...(spec.details ? { details: safeSchemaDetails(spec.details) } : {}),
    ...(observation.canonicalReference ? { relatedXapiReference: observation.canonicalReference } : {}),
    relatedSchemaSnapshotId: input.schemaSnapshot.id,
  }, observationsById, entriesByFileId, input.rulePack.version);
}

function directDependencyGraph(
  graph: ReturnType<typeof buildImportGraph>,
  importObservationByReference: Map<string, ImportObservation>,
): DirectDependencyEdge[] {
  const relationships = new Map<string, DirectDependencyEdge>();
  for (const edge of graph.directEdges) {
    const observation = importObservationByReference.get(`${edge.importer.id}:${edge.reference.node.start}`);
    if (!observation) continue;
    const key = `${edge.importer.id}:${edge.dependency.id}`;
    if (!relationships.has(key)) {
      relationships.set(key, {
        importerFileId: edge.importer.id,
        dependencyFileId: edge.dependency.id,
        observationId: observation.id,
      });
    }
  }
  return [...relationships.values()].sort((left, right) =>
    left.importerFileId.localeCompare(right.importerFileId)
    || left.dependencyFileId.localeCompare(right.dependencyFileId));
}

function unresolvedDependencyEdges(
  graph: ReturnType<typeof buildImportGraph>,
  importObservationByReference: Map<string, ImportObservation>,
): UnresolvedDependencyEdge[] {
  const grouped = new Map<string, typeof graph.unresolved>();
  for (const edge of graph.unresolved) {
    const group = grouped.get(edge.normalizedExpectedPath) ?? [];
    group.push(edge);
    grouped.set(edge.normalizedExpectedPath, group);
  }
  return [...grouped.entries()].map(([expectedPath, edges]) => {
    const virtualFileId = `missing-${stableHash(expectedPath)}`;
    const importerFileIds = [...new Set(edges.map((edge) => edge.importer.id))].sort();
    const affectedEntryMacroIds = affectedEntries(importerFileIds, graph.entriesByFileId);
    const dependencyRoutes = affectedEntryMacroIds.flatMap((entryMacroId) =>
      importerFileIds.flatMap((importerId) => {
        const route = graph.routesByEntryAndFile.get(`${entryMacroId}:${importerId}`);
        return route ? [{ entryMacroId, fileIds: [...route, virtualFileId] }] : [];
      }));
    const observationIds = edges
      .map((edge) => importObservationByReference.get(`${edge.importer.id}:${edge.reference.node.start}`)?.id)
      .filter((id): id is string => Boolean(id));
    return {
      id: `unresolved-edge-${stableHash(expectedPath)}`,
      virtualFileId,
      normalizedExpectedPath: expectedPath,
      importerFileIds,
      observationIds: [...new Set(observationIds)].sort(),
      affectedEntryMacroIds,
      dependencyRoutes,
      state: 'Not evaluated' as const,
    };
  }).sort((left, right) => left.normalizedExpectedPath.localeCompare(right.normalizedExpectedPath));
}

const priorityRank: Record<ReviewPriority, number> = {
  required: 0,
  warning: 1,
  advisory: 2,
  informational: 3,
};

function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort((left, right) =>
    priorityRank[left.priority] - priorityRank[right.priority]
    || left.category.localeCompare(right.category)
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id));
}

function applyEffectiveRulePack(
  findings: Finding[],
  effectiveRulePack: EffectiveRulePack,
): Finding[] {
  const ruleByCode = new Map(effectiveRulePack.rules.map((rule) => [rule.code, rule]));
  return findings.flatMap((finding) => {
    const rule = ruleByCode.get(finding.code as AnalysisRuleCode);
    if (!rule) {
      throw new Error(`Finding ${finding.code} has no supported Rule Pack configuration.`);
    }
    if (!rule.enabled) return [];
    const { citation: _candidateCitation, ...findingWithoutCitation } = finding;
    return [{
      ...findingWithoutCitation,
      priority: rule.priority,
      rule: {
        ...finding.rule,
        id: rule.id,
        version: rule.version,
        applicability: rule.applicability,
      },
      ...(rule.citation ? { citation: rule.citation } : {}),
    }];
  });
}

function findingImpacts(
  findings: Finding[],
  graph: ReturnType<typeof buildImportGraph>,
  unresolvedEdges: UnresolvedDependencyEdge[],
): FindingImpact[] {
  const impacts: FindingImpact[] = [];
  for (const finding of findings) {
    for (const sourceFileId of finding.sourceFileIds) {
      impacts.push({ findingId: finding.id, sourceFileId, impact: 'direct' });
      for (const entryMacroId of graph.entriesByFileId.get(sourceFileId) ?? []) {
        if (entryMacroId === sourceFileId) continue;
        const dependencyPath = graph.routesByEntryAndFile.get(`${entryMacroId}:${sourceFileId}`);
        impacts.push({
          findingId: finding.id,
          sourceFileId,
          impact: 'dependency',
          entryMacroId,
          ...(dependencyPath ? { dependencyPath } : {}),
        });
      }
    }
  }
  for (const finding of findings.filter((item) => item.code === 'coverage.missing-dependency')) {
    const edge = unresolvedEdges.find((candidate) =>
      candidate.observationIds.some((id) => finding.observationIds.includes(id)));
    if (!edge) continue;
    for (const route of edge.dependencyRoutes) {
      const sourceFileId = route.fileIds.at(-2);
      if (!sourceFileId) continue;
      impacts.push({
        findingId: finding.id,
        sourceFileId,
        impact: 'dependency',
        entryMacroId: route.entryMacroId,
        dependencyPath: route.fileIds,
      });
    }
  }
  const unique = [...new Map(impacts.map((impact) => [
    `${impact.findingId}:${impact.sourceFileId}:${impact.impact}:${impact.entryMacroId ?? ''}:${impact.dependencyPath?.join('>') ?? ''}`,
    impact,
  ])).values()];
  return unique.sort((left, right) =>
    left.findingId.localeCompare(right.findingId)
    || left.sourceFileId.localeCompare(right.sourceFileId)
    || left.impact.localeCompare(right.impact)
    || (left.entryMacroId ?? '').localeCompare(right.entryMacroId ?? ''));
}

function fileInventory(
  input: AnalysisInput,
  graph: ReturnType<typeof buildImportGraph>,
  contentHashes: Map<string, string>,
): FileInventoryEntry[] {
  const entryIds = new Set(graph.entries.map((file) => file.id));
  const dependencyIds = new Set(graph.directEdges.map((edge) => edge.dependency.id));
  const reachableIds = new Set(graph.reachable.map((file) => file.id));
  return input.macroSet.files.map((file): FileInventoryEntry => {
    const roles: FileInventoryEntry['roles'] = [];
    if (entryIds.has(file.id)) roles.push('Entry');
    if (dependencyIds.has(file.id)) roles.push('Dependency');
    const result = graph.parseResults.get(file.id);
    return {
      fileId: file.id,
      path: file.path,
      contentHash: contentHashes.get(file.id) ?? '',
      roles,
      activeState: file.active === true ? 'Active' : file.active === false ? 'Inactive' : 'Unknown',
      analysisState: !reachableIds.has(file.id)
        ? 'Not in analyzed graph'
        : result?.kind === 'parse-error'
          ? 'Parse failed'
          : 'Evaluated',
      affectedEntryMacroIds: graph.entriesByFileId.get(file.id) ?? [],
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function observationCoverage(
  input: AnalysisInput,
  graph: ReturnType<typeof buildImportGraph>,
  frontiers: XapiFlowFrontierObservation[],
): FileObservationCoverage[] {
  const reachableIds = new Set(graph.reachable.map((file) => file.id));
  const frontierFileIds = new Set(frontiers.map((frontier) => frontier.sourceReference.fileId));
  const unresolvedImporterIds = new Set(graph.allUnresolved.map((edge) => edge.importer.id));
  return input.macroSet.files.map((file) => {
    const reachable = reachableIds.has(file.id);
    const result = graph.parseResults.get(file.id);
    const dynamicImports = result?.kind === 'parsed' ? result.parsed.dynamicImports.length : 0;
    return {
      fileId: file.id,
      families: OBSERVATION_FAMILIES.map((family) => {
        if (family === 'imports' && result?.kind === 'parsed') {
          if (unresolvedImporterIds.has(file.id) || dynamicImports > 0) {
            return {
              family,
              state: 'Partial' as const,
              reason: unresolvedImporterIds.has(file.id)
                ? 'At least one local dependency could not be resolved from the supplied Macro Set.'
                : 'At least one dynamic import cannot be added to the static dependency graph.',
            };
          }
          return { family, state: 'Complete' as const };
        }
        if (!reachable) {
          return {
            family,
            state: 'Not evaluated' as const,
            reason: 'The supplied file is unreachable from every selected Entry Macro.',
          };
        }
        if (result?.kind === 'parse-error') {
          if (family === 'parser-diagnostics') return { family, state: 'Complete' as const };
          return {
            family,
            state: 'Not evaluated' as const,
            reason: 'JavaScript parsing failed before this observation family could be evaluated.',
          };
        }
        if (
          family === 'external-destinations'
          && result?.kind === 'parsed'
          && result.parsed.dynamicExternalUrls.length > 0
        ) {
          return {
            family,
            state: 'Partial' as const,
            reason: 'At least one URL determines its external destination at runtime.',
          };
        }
        if ((family === 'xapi-bindings' || family === 'xapi-touchpoints') && frontierFileIds.has(file.id)) {
          return {
            family,
            state: 'Partial' as const,
            reason: 'One or more proven xAPI routes reached a dynamic, opaque, unavailable, or mixed transformation.',
          };
        }
        return { family, state: 'Complete' as const };
      }),
    };
  });
}

function matchingOrigins(
  fileId: string,
  node: { start: number; end: number },
  origins: FlowValueOrigin[],
): FlowValueOrigin[] {
  return origins.filter((origin) =>
    origin.fileId === fileId
    && origin.start === node.start
    && origin.end === node.end);
}

function uniqueUrlRoutes(origins: FlowValueOrigin[]): UrlProvenanceRoute[] {
  return [...new Map(origins.map((origin) => [
    origin.route.hops.map((hop) => [
      hop.transformation,
      hop.sourceReference.fileId,
      hop.sourceReference.range.start.line,
      hop.sourceReference.range.start.column,
      hop.label ?? '',
    ].join(':')).join('>'),
    origin.route,
  ])).values()];
}

function explanation(
  reason: UrlUsageExplanation['reason'],
  summary: string,
  routes: UrlProvenanceRoute[],
  fallbackSourceReference: ExternalDependencyObservation['sourceReference'],
): UrlUsageExplanation {
  const lastSourceReference = routes
    .flatMap((route) => route.hops.at(-1)?.sourceReference ?? [])
    .at(-1) ?? fallbackSourceReference;
  return {
    reason,
    summary,
    lastSourceReference,
    ...(routes.length > 0 ? { provenanceRoutes: routes } : {}),
  };
}

function apiReferences(
  touchpoints: XapiTouchpointObservation[],
  graph: ReturnType<typeof buildImportGraph>,
): ApiReference[] {
  return touchpoints.flatMap((observation) => {
    const canonical = observation.canonicalReference;
    if (!canonical.complete || !observation.schemaEvidence) return [];
    return [{
      id: `api-${stableHash(observation.id)}`,
      observationId: observation.id,
      kind: canonical.kind,
      path: canonical.normalizedPathSegments.join(' '),
      operation: canonical.operation,
      syntax: observation.submittedSyntax === 'new-style' ? 'modern' : 'legacy',
      availability: observation.availability,
      schemaEvidence: observation.schemaEvidence,
      entryMacroIds: graph.entriesByFileId.get(observation.sourceReference.fileId) ?? [],
      source: observation.sourceReference,
    } satisfies ApiReference];
  }).sort((left, right) =>
    left.path.localeCompare(right.path)
    || left.kind.localeCompare(right.kind)
    || left.source.fileId.localeCompare(right.source.fileId)
    || left.source.range.start.line - right.source.range.start.line);
}

function noLiteralSourceLeak(report: AnalysisReport, files: MacroFile[]): void {
  const serialized = JSON.stringify(report);
  for (const file of files) {
    if (file.source.length >= 8 && serialized.includes(file.source)) {
      throw new Error(`Analysis Report attempted to embed source for ${file.id}.`);
    }
  }
}

export function analyzeMacroSet(input: AnalysisInput): AnalysisOutcome {
  const invalid = validateInput(input);
  if (invalid) return invalid;
  const effectiveRulePack = resolveEffectiveRulePack(input.rulePack);

  const graph = buildImportGraph(input.macroSet.files, input.macroSet.entryMacroIds);
  const reachableIds = new Set(graph.reachable.map((file) => file.id));
  const usableFileCount = [...graph.parsedById.keys()].filter((id) => reachableIds.has(id)).length;
  if (usableFileCount === 0) {
    return {
      kind: 'analysis-failure',
      failure: {
        code: 'no-usable-macro',
        message: 'No Entry-reachable macro file could be parsed, so no meaningful Analysis Report can be produced.',
      },
    };
  }

  const contentHashes = new Map(
    input.macroSet.files.map((file) => [file.id, sha256(file.source)]),
  );
  const observations: AnalysisObservation[] = [];
  const importObservationByReference = new Map<string, ImportObservation>();

  for (const edge of graph.directEdges) {
    const hash = contentHashes.get(edge.importer.id) ?? '';
    const observation: ImportObservation = {
      id: observationIdentity(
        'local-import',
        edge.importer,
        edge.reference.range,
        `resolved:${edge.dependency.id}`,
      ),
      family: 'imports',
      kind: 'local-import',
      normalizedExpectedPath: edge.dependency.path.replaceAll('\\', '/'),
      resolution: 'resolved',
      dependencyFileId: edge.dependency.id,
      sourceReference: sourceReference(edge.importer, hash, edge.reference.range),
    };
    observations.push(observation);
    importObservationByReference.set(`${edge.importer.id}:${edge.reference.node.start}`, observation);
  }
  for (const edge of graph.allUnresolved) {
    const hash = contentHashes.get(edge.importer.id) ?? '';
    const observation: ImportObservation = {
      id: observationIdentity(
        'local-import',
        edge.importer,
        edge.reference.range,
        `unresolved:${edge.normalizedExpectedPath}`,
      ),
      family: 'imports',
      kind: 'local-import',
      normalizedExpectedPath: edge.normalizedExpectedPath,
      resolution: 'unresolved',
      sourceReference: sourceReference(edge.importer, hash, edge.reference.range),
    };
    observations.push(observation);
    importObservationByReference.set(`${edge.importer.id}:${edge.reference.node.start}`, observation);
  }

  const dynamicImportObservationIdsByFile = new Map<string, string[]>();
  for (const parsed of graph.parsedById.values()) {
    for (const dynamicImport of parsed.dynamicImports) {
      const observation: ImportObservation = {
        id: observationIdentity(
          'dynamic-import',
          parsed.file,
          dynamicImport.range,
          String(dynamicImport.node.start),
        ),
        family: 'imports',
        kind: 'local-import',
        normalizedExpectedPath: '<dynamic import>',
        resolution: 'dynamic',
        sourceReference: sourceReference(
          parsed.file,
          contentHashes.get(parsed.file.id) ?? '',
          dynamicImport.range,
        ),
        limitations: ['The module target is determined at runtime and cannot be added to the static dependency graph.'],
      };
      observations.push(observation);
      const ids = dynamicImportObservationIdsByFile.get(parsed.file.id) ?? [];
      ids.push(observation.id);
      dynamicImportObservationIdsByFile.set(parsed.file.id, ids);
    }
  }

  for (const file of graph.reachable) {
    const result = graph.parseResults.get(file.id);
    const hash = contentHashes.get(file.id) ?? '';
    if (result?.kind === 'parse-error') {
      const range = result.range ?? {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 1 },
      };
      const observation: ParserDiagnosticObservation = {
        id: observationIdentity('parse-error', file, range, result.message),
        family: 'parser-diagnostics',
        kind: 'parser-diagnostic',
        code: 'parse-error',
        message: result.message,
        sourceReference: sourceReference(file, hash, range),
      };
      observations.push(observation);
      continue;
    }
    const parsed = graph.parsedById.get(file.id);
    if (!parsed) continue;
    observations.push(...commonJsObservations(parsed, hash));
    observations.push(...unresolvedIdentifierObservations(parsed, hash));
    observations.push(...credentialIndicatorObservations(file, hash));
  }

  const flow = analyzeXapiFlow(graph, contentHashes);
  for (const file of graph.reachable) {
    const parsed = graph.parsedById.get(file.id);
    if (!parsed) continue;
    const hash = contentHashes.get(file.id) ?? '';
    for (const externalUrl of parsed.externalUrls) {
      const occurrenceSourceReference = sourceReference(file, hash, externalUrl.range);
      const argumentOrigins = matchingOrigins(
        file.id,
        externalUrl.node,
        flow.argumentUses.flatMap((use) => use.valueOrigins),
      );
      const xmlOrigins = matchingOrigins(file.id, externalUrl.node, flow.xmlPayloadValueOrigins);
      const opaqueOrigins = matchingOrigins(file.id, externalUrl.node, flow.opaqueValueOrigins);
      const readOrigins = matchingOrigins(file.id, externalUrl.node, flow.readValueOrigins);
      const loggingOrigins = matchingOrigins(file.id, externalUrl.node, flow.loggingValueOrigins);
      const xmlPayload = externalUrl.xmlPayload || xmlOrigins.length > 0;
      const directXmlRoute: UrlProvenanceRoute = {
        hops: [
          {
            transformation: 'literal',
            sourceReference: occurrenceSourceReference,
          },
          {
            transformation: 'xml-payload',
            sourceReference: occurrenceSourceReference,
          },
        ],
      };
      const routes = uniqueUrlRoutes([
        ...argumentOrigins,
        ...xmlOrigins,
        ...opaqueOrigins,
        ...readOrigins,
        ...loggingOrigins,
      ]);
      if (xmlPayload && xmlOrigins.length === 0) routes.push(directXmlRoute);

      let usage: ExternalDependencyObservation['usage'];
      let usageExplanation: UrlUsageExplanation;
      if (argumentOrigins.length > 0 && xmlPayload) {
        usage = 'in-use';
        usageExplanation = explanation(
          'xapi-argument-and-xml-payload',
          'The URL is structurally present in XML and at least one supported source path reaches an argument of a proven xAPI touchpoint.',
          routes,
          occurrenceSourceReference,
        );
      } else if (argumentOrigins.length > 0) {
        usage = 'in-use';
        usageExplanation = explanation(
          'xapi-argument',
          'At least one supported source path reaches an argument of a proven xAPI touchpoint.',
          routes,
          occurrenceSourceReference,
        );
      } else if (xmlPayload) {
        usage = 'in-use';
        usageExplanation = explanation(
          'xml-payload',
          'The URL is structurally present in executable XML, which is treated as xAPI-bound in the RoomOS Macro runtime.',
          routes,
          occurrenceSourceReference,
        );
      } else if (opaqueOrigins.length > 0) {
        usage = 'use-unknown';
        usageExplanation = explanation(
          'opaque-flow',
          'A source path reaches an unsupported call, transformation, mutation, or external boundary before xAPI use can be proved or disproved.',
          routes,
          occurrenceSourceReference,
        );
      } else if (readOrigins.length === 0) {
        usage = 'not-in-use';
        usageExplanation = explanation(
          'never-read',
          'The URL value is assigned or constructed but no supported source path reads it.',
          routes,
          occurrenceSourceReference,
        );
      } else if (loggingOrigins.length > 0) {
        usage = 'not-in-use';
        usageExplanation = explanation(
          'logging-only',
          'The URL reaches console logging, and no supported path reaches xAPI.',
          routes,
          occurrenceSourceReference,
        );
      } else {
        usage = 'not-in-use';
        usageExplanation = explanation(
          'discarded',
          'The URL is read, but every supported path terminates without reaching xAPI.',
          routes,
          occurrenceSourceReference,
        );
      }

      const observation: ExternalDependencyObservation = {
        id: observationIdentity(
          'external-dependency',
          file,
          externalUrl.range,
          `${externalUrl.destination}:${externalUrl.protocol}:${externalUrl.node.start}:${usage}`,
        ),
        family: 'external-destinations',
        kind: 'external-dependency',
        destination: externalUrl.destination,
        protocol: externalUrl.protocol,
        usage,
        usageExplanation,
        sourceReference: occurrenceSourceReference,
      };
      observations.push(observation);
    }
    for (const commentedUrl of parsed.commentedUrls) {
      const occurrenceSourceReference = sourceReference(file, hash, commentedUrl.range);
      const observation: CommentedUrlObservation = {
        id: observationIdentity(
          'commented-url',
          file,
          commentedUrl.range,
          `${commentedUrl.destination}:${commentedUrl.protocol}`,
        ),
        family: 'external-destinations',
        kind: 'commented-url',
        destination: commentedUrl.destination,
        protocol: commentedUrl.protocol,
        usage: 'not-in-use',
        usageExplanation: explanation(
          'commented',
          'The URL occurs only in a JavaScript comment. It is evidence, not an External Dependency, and is hidden from the map by default.',
          [],
          occurrenceSourceReference,
        ),
        sourceReference: occurrenceSourceReference,
      };
      observations.push(observation);
    }
    for (const dynamicUrl of parsed.dynamicExternalUrls) {
      const occurrenceSourceReference = sourceReference(file, hash, dynamicUrl.range);
      const usage: DynamicUrlObservation['usage'] = dynamicUrl.xmlPayload
        ? 'in-use'
        : 'use-unknown';
      const usageExplanation = dynamicUrl.xmlPayload
        ? explanation(
            'xml-payload',
            'The dynamically addressed URL is structurally present in executable XML, so its use is proven even though its External Destination cannot be reconstructed.',
            [{
              hops: [
                { transformation: 'literal', sourceReference: occurrenceSourceReference },
                { transformation: 'xml-payload', sourceReference: occurrenceSourceReference },
              ],
            }],
            occurrenceSourceReference,
          )
        : explanation(
            'dynamic-destination',
            'The URL contains a runtime-computed host, so no External Destination can be reconstructed and downstream use remains unknown.',
            [{
              hops: [
                { transformation: 'literal', sourceReference: occurrenceSourceReference },
                { transformation: 'opaque-boundary', sourceReference: occurrenceSourceReference },
              ],
            }],
            occurrenceSourceReference,
          );
      const observation: DynamicUrlObservation = {
        id: observationIdentity(
          'dynamic-url',
          file,
          dynamicUrl.range,
          `${dynamicUrl.protocol ?? 'unknown'}:${dynamicUrl.node.start}:${usage}`,
        ),
        family: 'external-destinations',
        kind: 'dynamic-url',
        ...(dynamicUrl.protocol ? { protocol: dynamicUrl.protocol } : {}),
        usage,
        usageExplanation,
        sourceReference: occurrenceSourceReference,
      };
      observations.push(observation);
    }
  }
  observations.push(...flow.rootBindings, ...flow.bindingFlows, ...flow.frontiers);
  const schemaFindings: Array<{ spec: FindingSpec; observation: XapiTouchpointObservation }> = [];
  for (const touchpoint of flow.touchpoints) {
    const observation = touchpoint.observation;
    if (observation.canonicalReference.complete) {
      const matched = matchSchema(
        touchpoint.extractedReference,
        input.target,
        input.schemaSnapshot,
      );
      observation.availability = matched.availability;
      observation.schemaEvidence = matched.schemaEvidence;
      if (matched.schemaObject) {
        const canonicalPath = matched.schemaObject.normPath ?? matched.schemaObject.path;
        observation.canonicalReference.normalizedPathSegments = canonicalPath.split(/\s+/).filter(Boolean);
        observation.canonicalReference.documentationUrl = matched.schemaEvidence.documentationUrl;
      }
      for (const spec of matched.findingSpecs) schemaFindings.push({ spec, observation });
    }
    observations.push(observation);
  }

  observations.sort((left, right) =>
    left.sourceReference.fileId.localeCompare(right.sourceReference.fileId)
    || left.sourceReference.range.start.line - right.sourceReference.range.start.line
    || left.sourceReference.range.start.column - right.sourceReference.range.start.column
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id));
  const observationsById = new Map(observations.map((observation) => [observation.id, observation]));
  const findings: Finding[] = [];

  for (const file of graph.reachable) {
    const parseDiagnosticIds = observations
      .filter((observation) =>
        observation.kind === 'parser-diagnostic'
        && observation.sourceReference.fileId === file.id)
      .map((observation) => observation.id);
    if (parseDiagnosticIds.length > 0) {
      findings.push(buildFinding({
        code: 'coverage.parse-failure',
        title: `Could not parse ${file.path}`,
        summary: 'JavaScript parsing failed, so observation families that require an AST were not evaluated for this file.',
        category: 'Coverage',
        evidence: 'unknown',
        priority: 'warning',
        applicability: 'target-independent',
        observationIds: parseDiagnosticIds,
        technicalBasis: 'Explicit Source Analysis requires a valid JavaScript syntax tree before lexical or xAPI evidence can be extracted.',
        limitations: ['Other reachable, parseable files remain evaluated; this Finding makes no claim about the failed file beyond the parser diagnostic.'],
        recommendedAction: 'Correct the JavaScript syntax and analyze the same Macro Set again.',
      }, observationsById, graph.entriesByFileId, input.rulePack.version));
    }

    const dynamicImportIds = dynamicImportObservationIdsByFile.get(file.id) ?? [];
    if (dynamicImportIds.length > 0) {
      findings.push(buildFinding({
        code: 'coverage.dynamic-import',
        title: 'Dynamic imports limit dependency coverage',
        summary: 'One or more import targets are determined at runtime and are outside the static dependency graph.',
        category: 'Coverage',
        evidence: 'unknown',
        priority: 'warning',
        applicability: 'target-independent',
        observationIds: dynamicImportIds,
        technicalBasis: 'The analyzer adds a dependency edge only when a local module specifier is statically known.',
        limitations: ['No assumption is made about which dynamic module is selected or whether that branch executes.'],
        recommendedAction: 'Use static local imports or review every possible runtime target separately.',
      }, observationsById, graph.entriesByFileId, input.rulePack.version));
    }

    const commonJs = observations.filter((observation) =>
      observation.kind === 'commonjs-syntax'
      && observation.sourceReference.fileId === file.id);
    const configuredRule = input.rulePack.rules.find((rule) =>
      rule.kind === 'commonjs-migration' || rule.kind === 'commonjs-deprecation');
    if (commonJs.length > 0 && configuredRule?.enabled !== false) {
      findings.push(buildFinding({
        code: 'source.commonjs-migration',
        title: 'CommonJS Module Syntax must be migrated',
        summary: 'Executable CommonJS module syntax appears in this macro.',
        category: 'Syntax',
        evidence: 'observed-finding',
        priority: configuredRule?.priority ?? 'required',
        applicability: 'target-independent',
        observationIds: commonJs.map((observation) => observation.id),
        technicalBasis: 'The versioned Rule Pack defines ES module syntax as the unconditional source policy for RoomOS macros.',
        limitations: ['This source-policy Finding does not assert that a particular endpoint currently rejects CommonJS syntax.'],
        recommendedAction: 'Replace require, module.*, exports.*, __filename, and __dirname usage with ES module equivalents.',
        ruleId: configuredRule?.id ?? 'source.commonjs-migration',
        ...(configuredRule?.version ? { ruleVersion: configuredRule.version } : {}),
        ...(configuredRule?.citation ? { citation: configuredRule.citation } : {}),
      }, observationsById, graph.entriesByFileId, input.rulePack.version));
    }

    const credentials = observations.filter((observation) =>
      observation.kind === 'credential-indicator'
      && observation.sourceReference.fileId === file.id);
    if (credentials.length > 0) {
      const counts = new Map<string, number>();
      for (const observation of credentials) {
        if (observation.kind === 'credential-indicator') {
          counts.set(observation.canonicalTerm, (counts.get(observation.canonicalTerm) ?? 0) + 1);
        }
      }
      findings.push(buildFinding({
        code: 'source.sensitive-credential-indicator',
        title: 'Authentication-related vocabulary detected',
        summary: 'One or more source phrases match the authentication and credential review vocabulary.',
        category: 'Security',
        evidence: 'observed-finding',
        priority: 'warning',
        applicability: 'target-independent',
        observationIds: credentials.map((observation) => observation.id),
        technicalBasis: `Terms are matched with Credential Vocabulary ${CREDENTIAL_VOCABULARY_VERSION} across word components without arbitrary substring matching.`,
        limitations: ['A vocabulary match does not establish that a secret, credential, or usable value is present. Literal values are not retained in the report.'],
        recommendedAction: 'Review the highlighted local source and remove or externalize adjacent values only when they are actually sensitive.',
        details: {
          matchedTermCounts: [...counts.entries()]
            .map(([canonicalTerm, occurrenceCount]) => ({ canonicalTerm, occurrenceCount }))
            .sort((left, right) => left.canonicalTerm.localeCompare(right.canonicalTerm)),
        },
      }, observationsById, graph.entriesByFileId, input.rulePack.version));
    }

    const roots = flow.rootBindings.filter((observation) =>
      observation.sourceReference.fileId === file.id);
    const nonstandardRoots = roots.filter((observation) => !observation.conventionalName);
    if (nonstandardRoots.length > 0) {
      findings.push(buildFinding({
        code: 'source.nonstandard-xapi-root',
        title: 'Nonstandard xAPI Root Binding',
        summary: 'A proven xapi module root is bound under a local name other than exact `xapi`.',
        category: 'xAPI Touchpoints',
        evidence: 'observed-finding',
        priority: 'warning',
        applicability: 'target-independent',
        observationIds: nonstandardRoots.map((observation) => observation.id),
        technicalBasis: 'The Rule Pack uses `xapi` as the conventional root binding name while preserving analysis of every proven alias.',
        limitations: ['The naming convention does not reduce xAPI Binding Flow coverage and does not imply a runtime failure.'],
        recommendedAction: 'Prefer the exact local root name `xapi` when changing this module.',
      }, observationsById, graph.entriesByFileId, input.rulePack.version));
    }

    const fileFrontiers = flow.frontiers.filter((observation) =>
      observation.sourceReference.fileId === file.id);
    if (fileFrontiers.length > 0) {
      findings.push(buildFinding({
        code: 'coverage.xapi-flow-frontier',
        title: 'Dynamic xAPI Reference',
        summary: 'The complete xAPI path depends on content supplied at runtime, so the analyzer cannot verify the full reference.',
        category: 'Coverage',
        evidence: 'unknown',
        priority: 'advisory',
        applicability: 'target-independent',
        observationIds: fileFrontiers.map((frontier) => frontier.id),
        technicalBasis: 'Seeded xAPI Data Flow stops at the last statically proven hop when a runtime value, opaque transformation, or mixed binding prevents complete canonical path reconstruction.',
        limitations: ['Every independently proven route remains analyzed. A dynamic reference may be intentional and correct; this Advisory identifies source the analyzer cannot fully verify and does not claim the macro fails.'],
        recommendedAction: 'Review and test the content injected into each xAPI reference on the target device before release. If an error occurs, verify the constructed path first.',
      }, observationsById, graph.entriesByFileId, input.rulePack.version));
    }

    const fileTouchpoints = observations.filter((observation): observation is XapiTouchpointObservation =>
      observation.kind === 'xapi-touchpoint'
      && observation.sourceReference.fileId === file.id);
    const oldStyle = fileTouchpoints.filter((observation) => observation.submittedSyntax === 'old-style');
    const newStyle = fileTouchpoints.filter((observation) => observation.submittedSyntax === 'new-style');
    if (oldStyle.length > 0 && newStyle.length === 0) {
      findings.push(buildFinding({
        code: 'source.old-style-xapi',
        title: 'Old-style xAPI Usage',
        summary: 'This macro uses only Old-style xAPI Syntax. Old Style remains supported and acceptable. New Style is Preferred.',
        category: 'xAPI Touchpoints',
        evidence: 'observed-finding',
        priority: 'advisory',
        applicability: 'target-independent',
        observationIds: oldStyle.map((observation) => observation.id),
        technicalBasis: 'New Style is Preferred because it enables Macro Editor autocompletion and related quality-of-life improvements.',
        limitations: ['Old-style xAPI Syntax is not treated as deprecated or unsupported.'],
        recommendedAction: 'Use the preferred New-style expressions recorded with each canonical reference when refactoring.',
      }, observationsById, graph.entriesByFileId, input.rulePack.version));
    } else if (oldStyle.length > 0 && newStyle.length > 0) {
      findings.push(buildFinding({
        code: 'source.mixed-xapi-syntax',
        title: 'Mixed xAPI Syntax',
        summary: 'Old-style and New-style xAPI Syntax both appear in this macro.',
        category: 'xAPI Touchpoints',
        evidence: 'observed-finding',
        priority: 'advisory',
        applicability: 'target-independent',
        observationIds: [...oldStyle, ...newStyle].map((observation) => observation.id),
        technicalBasis: 'New Style is Preferred because it enables Macro Editor autocompletion and related quality-of-life improvements, and one style is easier to review within a macro.',
        limitations: ['Both submitted syntax styles remain acceptable; style differences between separate macros do not create this Finding.'],
        recommendedAction: 'Standardize this macro on the preferred New-style expressions when convenient.',
      }, observationsById, graph.entriesByFileId, input.rulePack.version));
    }

    const abstractedTouchpoints = fileTouchpoints.filter((observation) =>
      observation.bindingRoutes.some((route) =>
        route.hops.some((hop) => !['module-origin', 'commonjs-origin', 'touchpoint'].includes(hop.transformation))));
    if (abstractedTouchpoints.length > 0) {
      const bindingObservationIds = flow.bindingFlows
        .filter((observation) => observation.sourceReference.fileId === file.id)
        .map((observation) => observation.id);
      findings.push(buildFinding({
        code: 'source.xapi-abstraction',
        title: 'xAPI Abstraction',
        summary: 'A proven xAPI root flows through one or more local abstractions and reaches a touchpoint.',
        category: 'xAPI Touchpoints',
        evidence: 'observed-finding',
        priority: 'informational',
        applicability: 'target-independent',
        observationIds: [
          ...abstractedTouchpoints.map((observation) => observation.id),
          ...bindingObservationIds,
        ],
        technicalBasis: 'Each ordered xAPI Binding Route records exact binding names and transformations from a proven module origin.',
        limitations: ['A binding route is source evidence, not a runtime call trace or proof that the touchpoint executes.'],
        recommendedAction: 'No action is required; use the recorded routes to understand the abstraction.',
      }, observationsById, graph.entriesByFileId, input.rulePack.version));
    }

    const repeated = new Map<string, XapiTouchpointObservation[]>();
    for (const observation of fileTouchpoints.filter((item) => item.canonicalReference.complete)) {
      const key = `${observation.canonicalReference.kind}|${observation.canonicalReference.normalizedPathSegments.join(' ')}|${observation.canonicalReference.operation}`;
      const group = repeated.get(key) ?? [];
      group.push(observation);
      repeated.set(key, group);
    }
    for (const group of repeated.values()) {
      if (group.length < 2) continue;
      if (group[0]?.canonicalReference.operation === 'subscribe') continue;
      findings.push(buildFinding({
        code: 'source.repeated-xapi-reference',
        title: 'Repeated xAPI Reference',
        summary: 'The same canonical xAPI reference appears at multiple source occurrences in this macro.',
        category: 'xAPI Touchpoints',
        evidence: 'observed-finding',
        priority: 'advisory',
        applicability: 'target-independent',
        observationIds: group.map((observation) => observation.id),
        technicalBasis: 'Identity uses API kind, normalized path, and operation without dividing occurrences by arguments, syntax style, root name, or binding route.',
        limitations: ['Repeated source occurrences do not establish runtime call count, redundancy, or a defect.'],
        recommendedAction: 'Consider consolidating these occurrences behind a local wrapper when it would reduce maintenance.',
        relatedXapiReference: group[0]?.canonicalReference,
      }, observationsById, graph.entriesByFileId, input.rulePack.version));
    }
  }

  const unresolvedEdges = unresolvedDependencyEdges(graph, importObservationByReference);
  for (const unresolvedEdge of unresolvedEdges) {
    findings.push(buildFinding({
      code: 'coverage.missing-dependency',
      title: `Missing dependency ${unresolvedEdge.normalizedExpectedPath}`,
      summary: 'A statically resolved local dependency was not supplied, so its observations were not evaluated.',
      category: 'Coverage',
      evidence: 'unknown',
      priority: 'warning',
      applicability: 'target-independent',
      observationIds: unresolvedEdge.observationIds,
      technicalBasis: 'The direct import graph resolves local paths only against supplied Macro Set files and consolidates missing targets by normalized expected path.',
      limitations: ['Every supplied, independently reachable file remains analyzed. The missing virtual dependency is not treated as issue-free source.'],
      recommendedAction: 'Supply the normalized dependency path and analyze the complete Macro Set again.',
      details: {
        normalizedExpectedPath: unresolvedEdge.normalizedExpectedPath,
        importerFileIds: unresolvedEdge.importerFileIds,
        dependencyRoutes: unresolvedEdge.dependencyRoutes,
      },
    }, observationsById, graph.entriesByFileId, input.rulePack.version));
  }

  for (const { spec, observation } of schemaFindings) {
    findings.push(schemaFinding(spec, observation, observationsById, graph.entriesByFileId, input));
  }

  const touchpoints = observations.filter((observation): observation is XapiTouchpointObservation =>
    observation.kind === 'xapi-touchpoint' && observation.canonicalReference.complete);
  const subscriptionGroups = new Map<string, XapiTouchpointObservation[]>();
  for (const observation of touchpoints.filter((candidate) =>
    candidate.canonicalReference.operation === 'subscribe')) {
    const canonical = observation.canonicalReference;
    const key = `${canonical.kind}|${canonical.normalizedPathSegments.join(' ')}`;
    const group = subscriptionGroups.get(key) ?? [];
    group.push(observation);
    subscriptionGroups.set(key, group);
  }
  for (const group of subscriptionGroups.values()) {
    if (group.length < 2) continue;
    findings.push(buildFinding({
      code: 'source.duplicate-subscription',
      title: 'Duplicate Subscription Registration',
      summary: 'The same canonical xAPI subscription is registered at multiple source occurrences.',
      category: 'xAPI Touchpoints',
      evidence: 'observed-finding',
      priority: 'advisory',
      applicability: 'target-independent',
      observationIds: group.map((observation) => observation.id),
      technicalBasis: 'Subscription identity uses API kind and normalized path across the complete analyzed Macro Set.',
      limitations: ['Multiple source registrations do not establish how many handlers execute at runtime or whether the registrations are redundant.'],
      recommendedAction: 'Review the registrations together and consolidate them when one subscription owner can safely dispatch to the required handlers.',
      relatedXapiReference: group[0]?.canonicalReference,
      details: {
        registrationCount: group.length,
        sourceFileIds: [...new Set(group.map((observation) =>
          observation.sourceReference.fileId))].sort(),
      },
    }, observationsById, graph.entriesByFileId, input.rulePack.version));
  }
  const overlapGroups = new Map<string, XapiTouchpointObservation[]>();
  for (const observation of touchpoints) {
    const canonical = observation.canonicalReference;
    const key = `${canonical.kind}|${canonical.normalizedPathSegments.join(' ')}|${canonical.operation}`;
    const group = overlapGroups.get(key) ?? [];
    group.push(observation);
    overlapGroups.set(key, group);
  }

  const adjacency = new Map(input.macroSet.files.map((file) => [file.id, new Set<string>()]));
  for (const edge of graph.directEdges) {
    adjacency.get(edge.importer.id)?.add(edge.dependency.id);
    adjacency.get(edge.dependency.id)?.add(edge.importer.id);
  }
  const componentByFileId = new Map<string, string>();
  for (const fileId of [...adjacency.keys()].sort()) {
    if (componentByFileId.has(fileId)) continue;
    const pending = [fileId];
    componentByFileId.set(fileId, fileId);
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      for (const related of adjacency.get(current) ?? []) {
        if (componentByFileId.has(related)) continue;
        componentByFileId.set(related, fileId);
        pending.push(related);
      }
    }
  }

  for (const group of overlapGroups.values()) {
    const sourceFileIds = new Set(group.map((observation) => observation.sourceReference.fileId));
    if (sourceFileIds.size < 2) continue;
    const byComponent = new Map<string, XapiTouchpointObservation[]>();
    for (const observation of group) {
      const fileId = observation.sourceReference.fileId;
      const componentId = componentByFileId.get(fileId) ?? fileId;
      const component = byComponent.get(componentId) ?? [];
      component.push(observation);
      byComponent.set(componentId, component);
    }

    for (const component of byComponent.values()) {
      const linkedFileIds = new Set(component.map((observation) =>
        observation.sourceReference.fileId));
      if (linkedFileIds.size < 2) continue;
      findings.push(buildFinding({
        code: 'source.linked-cross-macro-xapi-overlap',
        title: 'Linked Macro xAPI Overlap',
        summary: 'The same canonical xAPI reference appears in macros connected by a supplied dependency relationship.',
        category: 'xAPI Touchpoints',
        evidence: 'observed-finding',
        priority: 'advisory',
        applicability: 'target-independent',
        observationIds: component.map((observation) => observation.id),
        technicalBasis: 'Identity uses API kind, normalized path, and operation; linkage uses the undirected transitive closure of supplied local imports.',
        limitations: ['Connected source occurrences do not establish runtime execution, behavioral duplication, or redundancy.'],
        recommendedAction: 'Review the linked modules and consolidate shared xAPI behavior when one owner or wrapper would reduce maintenance.',
        relatedXapiReference: component[0]?.canonicalReference,
        details: { relationship: 'linked', fileIds: [...linkedFileIds].sort() },
      }, observationsById, graph.entriesByFileId, input.rulePack.version));
    }

    if (byComponent.size >= 2) {
      findings.push(buildFinding({
        code: 'source.separate-cross-macro-xapi-overlap',
        title: 'Separate Macro xAPI Overlap',
        summary: 'The same canonical xAPI reference appears across otherwise separate macro dependency graphs.',
        category: 'xAPI Touchpoints',
        evidence: 'observed-finding',
        priority: 'informational',
        applicability: 'target-independent',
        observationIds: group.map((observation) => observation.id),
        technicalBasis: 'Identity uses API kind, normalized path, and operation; the source macros belong to separate connected components of the supplied import graph.',
        limitations: ['Separate source occurrences do not establish runtime execution, coordination requirements, or redundancy.'],
        recommendedAction: 'No action is required; use this inventory when coordinating separate macros that touch the same xAPI surface.',
        relatedXapiReference: group[0]?.canonicalReference,
        details: {
          relationship: 'separate',
          componentCount: byComponent.size,
          fileIds: [...sourceFileIds].sort(),
        },
      }, observationsById, graph.entriesByFileId, input.rulePack.version));
    }
  }

  const configuredFindings = sortFindings(
    applyEffectiveRulePack(findings, effectiveRulePack),
  );
  const references = apiReferences(touchpoints, graph);
  const counts: Record<ApiKind, number> = {
    Command: 0,
    Configuration: 0,
    Status: 0,
    Event: 0,
  };
  for (const reference of references) counts[reference.kind] += 1;
  const parsedCount = graph.reachable.filter((file) =>
    graph.parseResults.get(file.id)?.kind === 'parsed').length;
  const failedCount = graph.reachable.length - parsedCount;
  const dynamicArguments = flow.touchpoints.filter((touchpoint) =>
    touchpoint.extractedReference.argumentCoverage !== 'complete').length;
  const partial = failedCount > 0
    || unresolvedEdges.length > 0
    || graph.dynamicImportCount > 0
    || flow.frontiers.length > 0;

  const reportWithoutId: Omit<AnalysisReport, 'reportId'> = {
    schemaVersion: '2.3.0',
    generatedAt: input.analysisTime,
    provenance: {
      reportSchema: { id: 'analysis-report', version: '2.3.0' },
      analyzer: { name: 'Cisco Macro Analyzer', version: ANALYZER_VERSION },
      parser: { name: 'Acorn', version: PARSER_VERSION },
      rulePack: { id: effectiveRulePack.id, version: effectiveRulePack.version },
      credentialVocabulary: {
        id: 'macro-credential-vocabulary',
        version: effectiveRulePack.credentialVocabularyVersion,
      },
      recognizedMacroGlobals: {
        id: 'roomos-macro-globals',
        version: effectiveRulePack.recognizedMacroGlobalsVersion,
      },
      schemaSnapshot: {
        id: input.schemaSnapshot.id,
        release: input.schemaSnapshot.release,
        sha256: input.schemaSnapshot.sha256,
        objectCount: input.schemaSnapshot.objectCount,
        upstreamUpdatedAt: input.schemaSnapshot.upstreamUpdatedAt,
      },
      declaredTarget: input.target,
    },
    target: input.target,
    fileInventory: fileInventory(input, graph, contentHashes),
    observationLedger: observations,
    observationCoverage: observationCoverage(input, graph, flow.frontiers),
    directDependencyGraph: directDependencyGraph(graph, importObservationByReference),
    unresolvedDependencyEdges: unresolvedEdges,
    findings: configuredFindings,
    findingImpacts: findingImpacts(configuredFindings, graph, unresolvedEdges),
    coverage: {
      files: {
        supplied: input.macroSet.files.length,
        reachable: graph.reachable.length,
        parsed: parsedCount,
        failed: failedCount,
        notInAnalyzedGraph: input.macroSet.files.length - graph.reachable.length,
      },
      imports: {
        localResolved: new Set(graph.directEdges.map((edge) =>
          `${edge.importer.id}:${edge.dependency.id}`)).size,
        localUnresolved: unresolvedEdges.length,
        dynamic: graph.dynamicImportCount,
      },
      xapiReferences: {
        candidates: flow.touchpoints.length + flow.frontiers.length,
        staticallyResolved: references.length,
        dynamic: flow.frontiers.length,
        dynamicArguments,
      },
      completeness: partial ? 'partial' : 'complete-for-explicit-source-evidence',
    },
    inventory: { references, counts },
    limitations: LIMITATIONS,
  };
  const report: AnalysisReport = {
    ...reportWithoutId,
    reportId: `report-${stableHash(JSON.stringify(reportWithoutId))}`,
  };
  noLiteralSourceLeak(report, input.macroSet.files);
  return { kind: 'report', report };
}

export type {
  AnalysisInput,
  AnalysisOutcome,
  AnalysisReport,
  SchemaSnapshot,
} from './types';
