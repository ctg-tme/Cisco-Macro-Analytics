import type { VerifiedSchemaProvenance } from '../schemaCatalog';
import { calculateAndroidContainerReadiness } from '../presentation/androidContainerReadiness';
import { groupReferences, type ReferenceGroup } from '../presentation/referenceGroups';
import { sha256 } from './internal/reportSupport';
import type { SchemaCoverage } from './schemaCoverage';
import { summarizeSubscriptions, type SubscriptionAnalytics } from './subscriptionAnalytics';
import type {
  AnalysisReport,
  CommentedUrlObservation,
  DirectDependencyEdge,
  DynamicUrlObservation,
  EffectiveRulePack,
  ExternalDependencyObservation,
  FileInventoryEntry,
  UnresolvedDependencyEdge,
} from './types';

export const OMITTED_PER_SNAPSHOT_FINDING_CODES = [
  'schema.api-not-available',
  'schema.parent-path-match',
  'schema.product-restriction',
  'schema.operating-mode-restriction',
  'schema.runtime-role-restriction',
] as const;

export interface AnalysisSessionSchema {
  provenance: VerifiedSchemaProvenance;
  report: AnalysisReport;
}

export interface AnalysisSessionResult {
  schemaVersion: '1.1.0';
  sessionId: string;
  generatedAt: string;
  runtimeMetadataFields: string[];
  analyzedSourceSet: {
    files: FileInventoryEntry[];
    entryMacroIds: string[];
    relationships: {
      directDependencies: DirectDependencyEdge[];
      unresolvedDependencies: UnresolvedDependencyEdge[];
      externalDependencies: ExternalDependencyObservation[];
      dynamicUrls: DynamicUrlObservation[];
      commentedUrls: CommentedUrlObservation[];
    };
  };
  schemas: AnalysisSessionSchema[];
  comparison: SchemaCoverage;
  effectiveRulePack: EffectiveRulePack;
  analytics: {
    subscriptions: SubscriptionAnalytics;
  };
  limitations: string[];
}

export interface AnalysisSessionPresentation {
  primaryReport: AnalysisReport;
  displayReport: AnalysisReport;
  coverage: SchemaCoverage;
  referenceGroups: ReferenceGroup[];
  subscriptions: SubscriptionAnalytics;
  androidContainerReadiness: ReturnType<typeof calculateAndroidContainerReadiness>;
  omittedPerSnapshotFindingCodes: readonly string[];
  summary: {
    schemaSnapshots: number;
    entryMacros: number;
    xapiReferences: number;
    uniqueXapiPaths: number;
    findings: number;
    subscriptionRegistrations: number;
    uniqueSubscribedPaths: number;
  };
}

interface BuildAnalysisSessionInput {
  generatedAt: string;
  schemas: AnalysisSessionSchema[];
  comparison: SchemaCoverage;
  effectiveRulePack: EffectiveRulePack;
}

function externalDependencies(report: AnalysisReport): ExternalDependencyObservation[] {
  return report.observationLedger.filter(
    (observation): observation is ExternalDependencyObservation =>
      observation.kind === 'external-dependency',
  );
}

function dynamicUrls(report: AnalysisReport): DynamicUrlObservation[] {
  return report.observationLedger.filter(
    (observation): observation is DynamicUrlObservation =>
      observation.kind === 'dynamic-url',
  );
}

function commentedUrls(report: AnalysisReport): CommentedUrlObservation[] {
  return report.observationLedger.filter(
    (observation): observation is CommentedUrlObservation =>
      observation.kind === 'commented-url',
  );
}

function validateSchemas(input: BuildAnalysisSessionInput): AnalysisSessionSchema[] {
  if (input.schemas.length === 0) {
    throw new Error('A canonical analysis session requires at least one verified schema analysis.');
  }
  if (input.comparison.totalVersions !== input.schemas.length) {
    throw new Error('Schema comparison totals do not match the analyzed schema set.');
  }
  for (const item of input.schemas) {
    const { provenance, report } = item;
    if (
      !provenance.verified
      || provenance.expectedSha256 !== provenance.actualSha256
      || provenance.actualSha256 !== report.provenance.schemaSnapshot.sha256
      || provenance.schemaId !== report.provenance.schemaSnapshot.id
      || provenance.release !== report.provenance.schemaSnapshot.release
    ) {
      throw new Error(
        `Schema ${provenance.schemaId || report.provenance.schemaSnapshot.id} cannot enter the canonical session without matching verified provenance.`,
      );
    }
    if (
      report.provenance.rulePack.id !== input.effectiveRulePack.id
      || report.provenance.rulePack.version !== input.effectiveRulePack.version
    ) {
      throw new Error(`Schema ${provenance.schemaId} was analyzed with a different Rule Pack.`);
    }
  }
  return input.schemas;
}

export function buildAnalysisSession(input: BuildAnalysisSessionInput): AnalysisSessionResult {
  const schemas = validateSchemas(input);
  const primaryReport = schemas[0]!.report;
  const sourceIdentity = primaryReport.fileInventory.map((file) => ({
    fileId: file.fileId,
    path: file.path,
    contentHash: file.contentHash,
    activeState: file.activeState,
  }));
  const sessionIdentity = {
    sourceIdentity,
    schemaHashes: schemas.map((item) => item.provenance.actualSha256),
    effectiveRulePack: input.effectiveRulePack,
  };
  const subscriptions = summarizeSubscriptions(primaryReport.inventory.references);

  return {
    schemaVersion: '1.1.0',
    sessionId: `session-${sha256(JSON.stringify(sessionIdentity)).slice(0, 16)}`,
    generatedAt: input.generatedAt,
    runtimeMetadataFields: [
      'generatedAt',
      'schemas[].report.generatedAt',
      'schemas[].report.reportId',
    ],
    analyzedSourceSet: {
      files: primaryReport.fileInventory,
      entryMacroIds: primaryReport.fileInventory
        .filter((file) => file.roles.includes('Entry'))
        .map((file) => file.fileId)
        .sort(),
      relationships: {
        directDependencies: primaryReport.directDependencyGraph,
        unresolvedDependencies: primaryReport.unresolvedDependencyEdges,
        externalDependencies: externalDependencies(primaryReport),
        dynamicUrls: dynamicUrls(primaryReport),
        commentedUrls: commentedUrls(primaryReport),
      },
    },
    schemas,
    comparison: input.comparison,
    effectiveRulePack: input.effectiveRulePack,
    analytics: { subscriptions },
    limitations: [...new Set([
      ...primaryReport.limitations,
      'Cross-schema comparison is static schema evidence and does not establish runtime compatibility.',
    ])],
  };
}

export function deriveAnalysisSessionPresentation(
  session: AnalysisSessionResult,
): AnalysisSessionPresentation {
  const primaryReport = session.schemas[0]?.report;
  if (!primaryReport) throw new Error('The analysis session has no primary schema report.');
  const omitted = new Set<string>(OMITTED_PER_SNAPSHOT_FINDING_CODES);
  const displayReport: AnalysisReport = {
    ...primaryReport,
    findings: primaryReport.findings.filter((finding) => !omitted.has(finding.code)),
  };
  const referenceGroups = groupReferences(primaryReport.inventory.references);

  return {
    primaryReport,
    displayReport,
    coverage: session.comparison,
    referenceGroups,
    subscriptions: session.analytics.subscriptions,
    androidContainerReadiness:
      calculateAndroidContainerReadiness(primaryReport.inventory.references),
    omittedPerSnapshotFindingCodes: OMITTED_PER_SNAPSHOT_FINDING_CODES,
    summary: {
      schemaSnapshots: session.comparison.totalVersions,
      entryMacros: session.analyzedSourceSet.entryMacroIds.length,
      xapiReferences: primaryReport.inventory.references.length,
      uniqueXapiPaths: referenceGroups.length,
      findings: displayReport.findings.length,
      subscriptionRegistrations: session.analytics.subscriptions.totalRegistrations,
      uniqueSubscribedPaths: session.analytics.subscriptions.uniqueSubscribedPaths,
    },
  };
}
