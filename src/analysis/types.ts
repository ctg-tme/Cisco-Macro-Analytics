export interface SourcePosition {
  line: number;
  column: number;
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

export interface MacroFile {
  id: string;
  path: string;
  source: string;
  /**
   * Endpoint metadata only. It never selects an Entry Macro or changes the
   * dependency graph.
   */
  active?: boolean;
}

export interface MacroSet {
  files: MacroFile[];
  /**
   * Optional explicit graph roots for non-UI consumers. When omitted or empty,
   * the analyzer uses top-level graph roots (including every member of a
   * top-level cycle).
   */
  entryMacroIds?: string[];
}

export type AnalysisTarget =
  | {
      kind: 'declared';
      release: string;
      productModel: string;
      operatingMode: 'Native' | 'MTR';
      runtimeRole: 'Admin' | 'Integrator' | 'User';
    }
  | {
      kind: 'exploratory';
      partial?: Partial<{
        release: string;
        productModel: string;
        operatingMode: 'Native' | 'MTR';
        runtimeRole: 'Admin' | 'Integrator' | 'User';
      }>;
    };

export interface SchemaParameter {
  name: string;
  required?: boolean;
  type?: string;
  minimum?: number;
  maximum?: number;
  values?: Array<string | number | boolean>;
  valuespace?: Record<string, unknown>;
}

export interface SchemaObject {
  id?: string | number;
  type: 'Command' | 'Configuration' | 'Status' | 'Event' | string;
  path: string;
  normPath?: string;
  products?: string[];
  attributes?: {
    role?: string[];
    read?: string[];
    backend?: string;
    include_for_extension?: string;
    unavailableStates?: string;
    params?: SchemaParameter[];
    valueSpace?: Record<string, unknown>;
    valuespace?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export interface SchemaSnapshot {
  id: string;
  release: string;
  sha256: string;
  objectCount: number;
  objects: SchemaObject[];
  upstreamUpdatedAt: string;
}

export type AnalysisRuleCode =
  | 'coverage.parse-failure'
  | 'coverage.dynamic-import'
  | 'coverage.xapi-flow-frontier'
  | 'coverage.missing-dependency'
  | 'source.commonjs-migration'
  | 'source.sensitive-credential-indicator'
  | 'source.nonstandard-xapi-root'
  | 'source.old-style-xapi'
  | 'source.mixed-xapi-syntax'
  | 'source.xapi-abstraction'
  | 'source.repeated-xapi-reference'
  | 'source.duplicate-subscription'
  | 'source.linked-cross-macro-xapi-overlap'
  | 'source.separate-cross-macro-xapi-overlap'
  | 'schema.api-not-available'
  | 'schema.parent-path-match'
  | 'schema.path-casing-mismatch'
  | 'schema.required-parameter-missing'
  | 'schema.unknown-parameter'
  | 'schema.literal-out-of-range'
  | 'schema.literal-not-allowed'
  | 'schema.product-restriction'
  | 'schema.operating-mode-restriction'
  | 'schema.operating-mode-unknown'
  | 'schema.runtime-role-restriction';

export interface AnalysisRule {
  id: string;
  code?: AnalysisRuleCode;
  kind?:
    | 'commonjs-migration'
    | 'commonjs-deprecation'
    | 'unresolved-identifier'
    | 'sensitive-credential'
    | 'nonstandard-xapi-root'
    | 'old-style-xapi'
    | 'mixed-xapi-syntax'
    | 'xapi-abstraction'
    | 'repeated-xapi-reference'
    | 'cross-macro-xapi-overlap';
  title: string;
  enabled?: boolean;
  priority?: ReviewPriority;
  version?: string;
  citation?: string;
  applicability?: 'target-dependent' | 'target-independent';
  appliesTo?: {
    minimumRelease?: string;
    operatingModes?: Array<'Native' | 'MTR'>;
  };
}

export interface EffectiveAnalysisRule {
  code: AnalysisRuleCode;
  id: string;
  title: string;
  enabled: boolean;
  priority: ReviewPriority;
  version: string;
  applicability: RuleApplicability;
  citation?: string;
}

export interface RulePack {
  id: string;
  version: string;
  rules: AnalysisRule[];
  credentialVocabularyVersion?: string;
  recognizedMacroGlobalsVersion?: string;
}

export interface EffectiveRulePack {
  id: string;
  version: string;
  rules: EffectiveAnalysisRule[];
  credentialVocabularyVersion: string;
  recognizedMacroGlobalsVersion: string;
}

export interface AnalysisInput {
  macroSet: MacroSet;
  target: AnalysisTarget;
  schemaSnapshot: SchemaSnapshot;
  rulePack: RulePack;
  analysisTime: string;
}

export type EvidenceClass = 'observed-finding' | 'potential-risk' | 'unknown';
export type ReviewPriority = 'required' | 'warning' | 'advisory' | 'informational';
export type FindingCategory = 'Coverage' | 'Schema' | 'Security' | 'Syntax' | 'xAPI Touchpoints';
export type RuleApplicability = 'target-dependent' | 'target-independent';
export type ApiKind = 'Command' | 'Configuration' | 'Status' | 'Event';
export type ApiOperation = 'execute' | 'get' | 'set' | 'subscribe';
export type ApiAvailability =
  | 'available-in-declared-schema'
  | 'available-in-selected-schema'
  | 'not-in-declared-schema'
  | 'unavailable-for-product'
  | 'unavailable-for-mode'
  | 'unavailable-for-role'
  | 'unknown-for-mode'
  | 'unknown-in-exploratory-analysis';

export type SchemaRelationshipStatus = 'supported' | 'not-supported' | 'not-declared' | 'not-restricted' | 'unknown';
export type OperatingModeEvidenceBasis =
  | 'extension-marker'
  | 'teams-unavailable-state'
  | 'feature-dependent-event'
  | 'missing-metadata'
  | 'conflicting-metadata'
  | 'path-not-found';

export interface SchemaParameterSummary {
  name: string;
  required: boolean;
  type?: string;
  minimum?: number;
  maximum?: number;
  allowedValues?: Array<string | number | boolean>;
}

export interface SchemaEvidence {
  existsInSnapshot: boolean;
  matchKind: 'exact' | 'parent' | 'none';
  snapshotObjectId?: string | number;
  descendantCount?: number;
  descendantPaths?: string[];
  documentationUrl: string;
  product: {
    status: SchemaRelationshipStatus;
    declaredProduct?: string;
    supportedProducts: string[];
  };
  operatingMode: {
    status: Exclude<SchemaRelationshipStatus, 'not-restricted'>;
    declaredMode?: 'Native' | 'MTR';
    supportsMtr: boolean | null;
    basis: OperatingModeEvidenceBasis;
  };
  role: {
    status: SchemaRelationshipStatus;
    declaredRole?: 'Admin' | 'Integrator' | 'User';
    allowedRoles: string[];
  };
  parameters: SchemaParameterSummary[];
  valueConstraint?: Omit<SchemaParameterSummary, 'name' | 'required'>;
}

/**
 * A report-safe join to source retained by the user. Paths live in the file
 * inventory; source text and excerpts never live in this reference.
 */
export interface SourceReference {
  fileId: string;
  fileContentHash: string;
  range: SourceRange;
}

export type ObservationFamily =
  | 'imports'
  | 'external-domains'
  | 'parser-diagnostics'
  | 'module-syntax'
  | 'lexical-scope'
  | 'credential-indicators'
  | 'xapi-bindings'
  | 'xapi-touchpoints';

export type ObservationCoverageState = 'Complete' | 'Partial' | 'Not evaluated';

export interface ObservationCoverage {
  family: ObservationFamily;
  state: ObservationCoverageState;
  reason?: string;
}

export interface FileObservationCoverage {
  fileId: string;
  families: ObservationCoverage[];
}

export interface XapiBindingRouteHop {
  bindingName: string;
  transformation:
    | 'module-origin'
    | 'commonjs-origin'
    | 're-export'
    | 'import'
    | 'alias'
    | 'assignment'
    | 'destructure'
    | 'argument-to-parameter'
    | 'method-argument-to-parameter'
    | 'constructor-argument-to-parameter'
    | 'return'
    | 'instance-property'
    | 'object-property'
    | 'touchpoint';
  sourceReference: SourceReference;
  dependencyCrossing?: {
    fromFileId: string;
    toFileId: string;
  };
}

export interface XapiBindingRoute {
  hops: XapiBindingRouteHop[];
}

export interface CanonicalXapiReference {
  kind: ApiKind;
  normalizedPathSegments: string[];
  operation: ApiOperation;
  complete: boolean;
  preferredNewStyleExpression?: string;
  documentationUrl?: string;
  limitation?: string;
}

export interface ArgumentPropertyShape {
  name: string;
  detectableValueType: string;
  valueForm: 'static' | 'dynamic';
  containerForm: string;
}

export interface ArgumentPositionShape {
  position: number;
  containerForm: string;
  detectableValueType: string;
  valueForm: 'static' | 'dynamic';
  propertyNames: string[];
  properties?: ArgumentPropertyShape[];
}

export interface ArgumentShape {
  argumentCount: number;
  positions: ArgumentPositionShape[];
}

interface BaseObservation {
  id: string;
  family: ObservationFamily;
  sourceReference: SourceReference;
  limitations?: string[];
}

export interface ImportObservation extends BaseObservation {
  family: 'imports';
  kind: 'local-import';
  normalizedExpectedPath: string;
  resolution: 'resolved' | 'unresolved' | 'dynamic';
  dependencyFileId?: string;
}

export interface ExternalDomainObservation extends BaseObservation {
  family: 'external-domains';
  kind: 'external-domain';
  domain: string;
  protocol: string;
  usage:
    | 'xapi-parameter'
    | 'xml-payload'
    | 'xapi-parameter-and-xml-payload'
    | 'not-in-use';
}

export interface ParserDiagnosticObservation extends BaseObservation {
  family: 'parser-diagnostics';
  kind: 'parser-diagnostic';
  code: 'parse-error';
  message: string;
}

export interface CommonJsObservation extends BaseObservation {
  family: 'module-syntax';
  kind: 'commonjs-syntax';
  form: 'require' | 'module-member' | 'exports-member' | '__filename' | '__dirname';
}

export interface UnresolvedIdentifierObservation extends BaseObservation {
  family: 'lexical-scope';
  kind: 'unresolved-identifier';
  identifier: string;
}

export interface CredentialIndicatorObservation extends BaseObservation {
  family: 'credential-indicators';
  kind: 'credential-indicator';
  category: string;
  canonicalTerm: string;
  submittedTerm: string;
  location: 'source' | 'filename';
}

export interface XapiRootBindingObservation extends BaseObservation {
  family: 'xapi-bindings';
  kind: 'xapi-root-binding';
  bindingName: string;
  origin: 'esm-import' | 'commonjs-require' | 're-export';
  conventionalName: boolean;
  route: XapiBindingRoute;
}

export interface XapiBindingFlowObservation extends BaseObservation {
  family: 'xapi-bindings';
  kind: 'xapi-binding-flow';
  bindingName: string;
  transformation: XapiBindingRouteHop['transformation'];
  route: XapiBindingRoute;
}

export interface XapiFlowFrontierObservation extends BaseObservation {
  family: 'xapi-bindings';
  kind: 'xapi-flow-frontier';
  frontierType: 'computed-path' | 'opaque-call' | 'mixed-flow' | 'dynamic-transformation';
  knownPathPrefix: string[];
  routes: XapiBindingRoute[];
  relatedObservationIds?: string[];
}

export interface XapiTouchpointObservation extends BaseObservation {
  family: 'xapi-touchpoints';
  kind: 'xapi-touchpoint';
  submittedSyntax: 'new-style' | 'old-style';
  canonicalReference: CanonicalXapiReference;
  argumentShape: ArgumentShape;
  bindingRoutes: XapiBindingRoute[];
  availability: ApiAvailability;
  schemaEvidence?: SchemaEvidence;
}

export type AnalysisObservation =
  | ImportObservation
  | ExternalDomainObservation
  | ParserDiagnosticObservation
  | CommonJsObservation
  | UnresolvedIdentifierObservation
  | CredentialIndicatorObservation
  | XapiRootBindingObservation
  | XapiBindingFlowObservation
  | XapiFlowFrontierObservation
  | XapiTouchpointObservation;

export interface FileInventoryEntry {
  fileId: string;
  path: string;
  contentHash: string;
  roles: Array<'Entry' | 'Dependency'>;
  activeState: 'Active' | 'Inactive' | 'Unknown';
  analysisState: 'Evaluated' | 'Parse failed' | 'Not in analyzed graph';
  affectedEntryMacroIds: string[];
}

export interface DirectDependencyEdge {
  importerFileId: string;
  dependencyFileId: string;
  observationId: string;
}

export interface DependencyRoute {
  entryMacroId: string;
  fileIds: string[];
}

export interface UnresolvedDependencyEdge {
  id: string;
  virtualFileId: string;
  normalizedExpectedPath: string;
  importerFileIds: string[];
  observationIds: string[];
  affectedEntryMacroIds: string[];
  dependencyRoutes: DependencyRoute[];
  state: 'Not evaluated';
}

export interface Finding {
  id: string;
  rule: {
    id: string;
    version: string;
    applicability: RuleApplicability;
    evidenceRequirements: string[];
  };
  code: string;
  title: string;
  summary: string;
  category: FindingCategory;
  evidence: EvidenceClass;
  priority: ReviewPriority;
  observationIds: string[];
  sourceFileIds: string[];
  affectedEntryMacroIds: string[];
  technicalBasis: string;
  limitations: string[];
  recommendedAction: string;
  citation?: string;
  relatedXapiReference?: CanonicalXapiReference;
  relatedSchemaSnapshotId?: string;
  details?: Record<string, unknown>;
}

export interface FindingImpact {
  findingId: string;
  sourceFileId: string;
  impact: 'direct' | 'dependency';
  entryMacroId?: string;
  dependencyPath?: string[];
}

/**
 * A convenient in-memory rendering of a complete xAPI touchpoint. It is
 * derived from the Observation Ledger and is not a second evidence source.
 */
export interface ApiReference {
  id: string;
  observationId: string;
  kind: ApiKind;
  path: string;
  operation: ApiOperation;
  syntax: 'modern' | 'legacy';
  availability: ApiAvailability;
  schemaEvidence: SchemaEvidence;
  entryMacroIds: string[];
  source: SourceReference;
}

export interface AnalysisReport {
  schemaVersion: '2.2.0';
  reportId: string;
  generatedAt: string;
  provenance: {
    reportSchema: { id: 'analysis-report'; version: '2.2.0' };
    analyzer: { name: 'Cisco Macro Analyzer'; version: string };
    parser: { name: 'Acorn'; version: string };
    rulePack: { id: string; version: string };
    credentialVocabulary: { id: 'macro-credential-vocabulary'; version: string };
    recognizedMacroGlobals: { id: 'roomos-macro-globals'; version: string };
    schemaSnapshot: {
      id: string;
      release: string;
      sha256: string;
      objectCount: number;
      upstreamUpdatedAt: string;
    };
    declaredTarget: AnalysisTarget;
  };
  target: AnalysisTarget;
  fileInventory: FileInventoryEntry[];
  observationLedger: AnalysisObservation[];
  observationCoverage: FileObservationCoverage[];
  directDependencyGraph: DirectDependencyEdge[];
  unresolvedDependencyEdges: UnresolvedDependencyEdge[];
  findings: Finding[];
  findingImpacts: FindingImpact[];
  coverage: {
    files: { supplied: number; reachable: number; parsed: number; failed: number; notInAnalyzedGraph: number };
    imports: { localResolved: number; localUnresolved: number; dynamic: number };
    xapiReferences: { candidates: number; staticallyResolved: number; dynamic: number; dynamicArguments: number };
    completeness: 'complete-for-explicit-source-evidence' | 'partial';
  };
  /**
   * Derived convenience view used by the current browser renderer. Every item
   * points back to an xAPI Touchpoint observation.
   */
  inventory: {
    references: ApiReference[];
    counts: Record<ApiKind, number>;
  };
  limitations: string[];
}

export interface AnalysisFailure {
  code: 'invalid-input' | 'invalid-schema-snapshot' | 'no-usable-macro';
  message: string;
  details?: string[];
}

export type AnalysisOutcome =
  | { kind: 'report'; report: AnalysisReport }
  | { kind: 'analysis-failure'; failure: AnalysisFailure };
