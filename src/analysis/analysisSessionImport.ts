import Ajv2020 from 'ajv/dist/2020';
import reportSchema from './report.schema.json';
import {
  deriveAnalysisSessionPresentation,
  type AnalysisSessionResult,
} from './analysisSession';
import type { AnalysisReport } from './types';

const validateReport = new Ajv2020({
  strict: false,
  validateFormats: false,
}).compile(reportSchema);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function requireArray(
  record: Record<string, unknown>,
  key: string,
  context: string,
): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`${context} is missing ${key}.`);
  }
  return value;
}

function requireRecord(
  record: Record<string, unknown>,
  key: string,
  context: string,
): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    throw new Error(`${context} is missing ${key}.`);
  }
  return value;
}

function validateSessionShape(value: Record<string, unknown>): void {
  if (
    value.schemaVersion !== '1.1.0'
    || typeof value.sessionId !== 'string'
    || typeof value.generatedAt !== 'string'
    || !isStringArray(value.runtimeMetadataFields)
    || !isStringArray(value.limitations)
  ) {
    throw new Error('The selected file is not a complete Analysis Session Result 1.1.0.');
  }

  const analyzedSourceSet = requireRecord(
    value,
    'analyzedSourceSet',
    'The Analysis Session Result',
  );
  requireArray(analyzedSourceSet, 'files', 'The analyzed source set');
  const entryMacroIds = analyzedSourceSet.entryMacroIds;
  if (!isStringArray(entryMacroIds)) {
    throw new Error('The analyzed source set is missing entryMacroIds.');
  }
  const relationships = requireRecord(
    analyzedSourceSet,
    'relationships',
    'The analyzed source set',
  );
  requireArray(relationships, 'directDependencies', 'The analyzed source relationships');
  requireArray(relationships, 'unresolvedDependencies', 'The analyzed source relationships');
  requireArray(relationships, 'externalDependencies', 'The analyzed source relationships');
  requireArray(relationships, 'dynamicUrls', 'The analyzed source relationships');
  requireArray(relationships, 'commentedUrls', 'The analyzed source relationships');

  const comparison = requireRecord(value, 'comparison', 'The Analysis Session Result');
  if (
    typeof comparison.totalVersions !== 'number'
    || typeof comparison.totalReferences !== 'number'
  ) {
    throw new Error('The Analysis Session Result contains an invalid schema comparison.');
  }
  [
    'compatibleVersions',
    'exactCompatibleVersions',
    'parentWarningVersions',
    'incompatibleVersions',
    'compatibilityByChannel',
    'references',
  ].forEach((key) => requireArray(comparison, key, 'The schema comparison'));

  const rulePack = requireRecord(
    value,
    'effectiveRulePack',
    'The Analysis Session Result',
  );
  if (
    typeof rulePack.id !== 'string'
    || typeof rulePack.version !== 'string'
    || !Array.isArray(rulePack.rules)
  ) {
    throw new Error('The Analysis Session Result contains an invalid Rule Pack.');
  }

  const analytics = requireRecord(value, 'analytics', 'The Analysis Session Result');
  const subscriptions = requireRecord(analytics, 'subscriptions', 'The session analytics');
  if (
    typeof subscriptions.totalRegistrations !== 'number'
    || typeof subscriptions.uniqueSubscribedPaths !== 'number'
    || typeof subscriptions.duplicateRegistrations !== 'number'
    || !isRecord(subscriptions.byBranch)
  ) {
    throw new Error('The Analysis Session Result contains invalid subscription analytics.');
  }
}

function validateSchemas(value: Record<string, unknown>): void {
  const schemas = requireArray(value, 'schemas', 'The Analysis Session Result');
  if (schemas.length === 0) {
    throw new Error('The Analysis Session Result does not contain a schema report.');
  }
  const comparison = value.comparison as Record<string, unknown>;
  if (comparison.totalVersions !== schemas.length) {
    throw new Error('The schema comparison total does not match the imported reports.');
  }

  const comparisonVersions = [
    ...(comparison.compatibleVersions as unknown[]),
    ...(comparison.incompatibleVersions as unknown[]),
  ];
  const comparisonSchemaIds = new Set(comparisonVersions.flatMap((version) =>
    isRecord(version) && typeof version.id === 'string' ? [version.id] : []));

  schemas.forEach((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Schema ${index + 1} is not a valid session entry.`);
    }
    const provenance = requireRecord(item, 'provenance', `Schema ${index + 1}`);
    const reportValue = item.report;
    if (!validateReport(reportValue)) {
      const problem = validateReport.errors?.[0];
      const detail = problem
        ? ` ${problem.instancePath || 'report'} ${problem.message ?? 'is invalid'}.`
        : '';
      throw new Error(`Schema ${index + 1} contains an invalid Analysis Report.${detail}`);
    }
    const report = reportValue as unknown as AnalysisReport;
    if (
      provenance.verified !== true
      || typeof provenance.schemaId !== 'string'
      || provenance.expectedSha256 !== provenance.actualSha256
      || provenance.schemaId !== report.provenance.schemaSnapshot.id
      || provenance.release !== report.provenance.schemaSnapshot.release
      || provenance.actualSha256 !== report.provenance.schemaSnapshot.sha256
    ) {
      throw new Error(`Schema ${index + 1} does not contain matching verified provenance.`);
    }
    if (!comparisonSchemaIds.has(provenance.schemaId)) {
      throw new Error(`Schema ${index + 1} is missing from the schema comparison.`);
    }
  });
}

export function parseAnalysisSessionJson(text: string): AnalysisSessionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }

  if (
    isRecord(parsed)
    && parsed.exportKind === 'macro-analysis'
  ) {
    throw new Error(
      'Choose full-analysis.json; files from independent-macro-analysis do not contain the complete session.',
    );
  }
  if (!isRecord(parsed)) {
    throw new Error('The selected file is not a complete Analysis Session Result 1.0.0.');
  }

  validateSessionShape(parsed);
  validateSchemas(parsed);
  const session = parsed as unknown as AnalysisSessionResult;
  try {
    deriveAnalysisSessionPresentation(session);
  } catch {
    throw new Error('The Analysis Session Result cannot be rendered by this version.');
  }
  return session;
}
