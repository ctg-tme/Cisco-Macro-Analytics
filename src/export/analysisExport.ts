import { strToU8, zipSync } from 'fflate';
import type {
  AnalysisReport,
  ApiReference,
  DirectDependencyEdge,
  EffectiveRulePack,
  FileInventoryEntry,
  FileObservationCoverage,
  Finding,
  FindingImpact,
  UnresolvedDependencyEdge,
  AnalysisObservation,
} from '../analysis/types';
import type {
  AnalysisSessionResult,
  AnalysisSessionSchema,
} from '../analysis/analysisSession';
import type { VerifiedSchemaProvenance } from '../schemaCatalog';

export interface MacroAnalysisSchemaExport {
  provenance: VerifiedSchemaProvenance;
  reportId: string;
  reportSchemaVersion: AnalysisReport['schemaVersion'];
  generatedAt: string;
  analysisProvenance: AnalysisReport['provenance'];
  target: AnalysisReport['target'];
  observations: AnalysisObservation[];
  observationCoverage: FileObservationCoverage[];
  findings: Finding[];
  findingImpacts: FindingImpact[];
  references: ApiReference[];
  relationships: {
    directDependencies: DirectDependencyEdge[];
    unresolvedDependencies: UnresolvedDependencyEdge[];
  };
  limitations: string[];
}

export interface MacroAnalysisExport {
  schemaVersion: '1.0.0';
  exportKind: 'macro-analysis';
  sessionId: string;
  generatedAt: string;
  macro: FileInventoryEntry;
  effectiveRulePack: EffectiveRulePack;
  schemas: MacroAnalysisSchemaExport[];
  limitations: string[];
}

function findingAppliesToMacro(finding: Finding, fileId: string): boolean {
  return finding.sourceFileIds.includes(fileId)
    || finding.affectedEntryMacroIds.includes(fileId);
}

function schemaProjectionForMacro(
  schema: AnalysisSessionSchema,
  fileId: string,
): MacroAnalysisSchemaExport {
  const { report } = schema;
  const findings = report.findings.filter((finding) =>
    findingAppliesToMacro(finding, fileId));
  const findingIds = new Set(findings.map((finding) => finding.id));
  const relevantObservationIds = new Set(
    findings.flatMap((finding) => finding.observationIds),
  );

  for (const observation of report.observationLedger) {
    if (observation.sourceReference.fileId === fileId) {
      relevantObservationIds.add(observation.id);
    }
  }

  return {
    provenance: schema.provenance,
    reportId: report.reportId,
    reportSchemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    analysisProvenance: report.provenance,
    target: report.target,
    observations: report.observationLedger.filter((observation) =>
      relevantObservationIds.has(observation.id)),
    observationCoverage: report.observationCoverage.filter(
      (coverage) => coverage.fileId === fileId,
    ),
    findings,
    findingImpacts: report.findingImpacts.filter((impact) =>
      findingIds.has(impact.findingId)
      && (impact.sourceFileId === fileId || impact.entryMacroId === fileId)),
    references: report.inventory.references.filter(
      (reference) =>
        reference.source.fileId === fileId
        || reference.entryMacroIds.includes(fileId),
    ),
    relationships: {
      directDependencies: report.directDependencyGraph.filter(
        (edge) =>
          edge.importerFileId === fileId
          || edge.dependencyFileId === fileId
          || relevantObservationIds.has(edge.observationId),
      ),
      unresolvedDependencies: report.unresolvedDependencyEdges.filter(
        (edge) =>
          edge.importerFileIds.includes(fileId)
          || edge.affectedEntryMacroIds.includes(fileId)
          || edge.observationIds.some((id) => relevantObservationIds.has(id)),
      ),
    },
    limitations: report.limitations,
  };
}

function macroExport(
  session: AnalysisSessionResult,
  macro: FileInventoryEntry,
): MacroAnalysisExport {
  return {
    schemaVersion: '1.0.0',
    exportKind: 'macro-analysis',
    sessionId: session.sessionId,
    generatedAt: session.generatedAt,
    macro,
    effectiveRulePack: session.effectiveRulePack,
    schemas: session.schemas.map((schema) =>
      schemaProjectionForMacro(schema, macro.fileId)),
    limitations: session.limitations,
  };
}

function macroArchiveStem(path: string): string {
  const filename = path.split(/[\\/]/).at(-1) ?? '';
  const stem = filename.replace(/\.(?:m?js)$/i, '');
  return stem
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'macro';
}

function jsonEntry(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

export function buildAnalysisExportEntries(
  session: AnalysisSessionResult,
): Record<string, Uint8Array> {
  const entries: Record<string, Uint8Array> = {
    'full-analysis.json': jsonEntry(session),
  };
  const macros = [...session.analyzedSourceSet.files].sort((left, right) => {
    const entryOrder =
      Number(right.roles.includes('Entry')) - Number(left.roles.includes('Entry'));
    return entryOrder || left.path.localeCompare(right.path);
  });
  const usedMacroNames = new Map<string, number>();

  macros.forEach((macro) => {
    const stem = macroArchiveStem(macro.path);
    const collisionKey = stem.toLocaleLowerCase('en-US');
    const occurrence = (usedMacroNames.get(collisionKey) ?? 0) + 1;
    usedMacroNames.set(collisionKey, occurrence);
    const collisionSuffix = occurrence === 1 ? '' : `_${occurrence}`;
    entries[
      `independent-macro-analysis/${stem}_analysis${collisionSuffix}.json`
    ] = jsonEntry(macroExport(session, macro));
  });

  return entries;
}

/**
 * This intentionally performs synchronous compression. Call it only inside
 * the dedicated export worker so large archives never block the interface.
 */
export function createAnalysisExportArchive(
  session: AnalysisSessionResult,
): Uint8Array {
  return zipSync(buildAnalysisExportEntries(session), { level: 6 });
}
