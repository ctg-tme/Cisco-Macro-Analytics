import type { ApiKind, SchemaEvidence } from './types';

export interface SchemaVersionIdentity {
  id: string;
  release: string;
  label: string;
  channel: 'cloud' | 'on-premises';
  sha256: string;
}

export interface SchemaVersionAnalysis {
  version: SchemaVersionIdentity;
  references: Array<{
    kind: ApiKind;
    path: string;
    schemaEvidence: Pick<SchemaEvidence, 'matchKind'>;
  }>;
}

export interface ReferenceSchemaCoverage {
  key: string;
  kind: ApiKind;
  path: string;
  exactVersions: SchemaVersionIdentity[];
  parentVersions: SchemaVersionIdentity[];
  missingVersions: SchemaVersionIdentity[];
}

export interface SchemaReferenceIdentity {
  key: string;
  kind: ApiKind;
  path: string;
}

export interface VersionSchemaCoverage extends SchemaVersionIdentity {
  status: 'exact' | 'parent-warning' | 'missing';
  exactPathCount: number;
  parentPathCount: number;
  missingPathCount: number;
  parentReferences: SchemaReferenceIdentity[];
  missingReferences: SchemaReferenceIdentity[];
}

export interface ChannelCompatibilityBoundary {
  channel: SchemaVersionIdentity['channel'];
  earliestCompatibleVersion: VersionSchemaCoverage | null;
  latestCompatibleVersion: VersionSchemaCoverage | null;
  latestCatalogVersion: VersionSchemaCoverage | null;
  laterIncompatibleVersions: VersionSchemaCoverage[];
}

export interface SchemaCoverage {
  totalVersions: number;
  totalReferences: number;
  compatibleVersions: VersionSchemaCoverage[];
  exactCompatibleVersions: VersionSchemaCoverage[];
  parentWarningVersions: VersionSchemaCoverage[];
  incompatibleVersions: VersionSchemaCoverage[];
  earliestCompatibleVersion: VersionSchemaCoverage | null;
  latestCompatibleVersion: VersionSchemaCoverage | null;
  latestCatalogVersion: VersionSchemaCoverage | null;
  compatibilityByChannel: ChannelCompatibilityBoundary[];
  references: ReferenceSchemaCoverage[];
}

function referenceKey(kind: ApiKind, path: string): string {
  return `${kind}|${path}`;
}

function matchKindFor(
  analysis: SchemaVersionAnalysis,
  key: string,
): SchemaEvidence['matchKind'] {
  const matches = analysis.references.filter((reference) =>
    referenceKey(reference.kind, reference.path) === key,
  );
  if (matches.length === 0 || matches.some((reference) => reference.schemaEvidence.matchKind === 'none')) return 'none';
  if (matches.some((reference) => reference.schemaEvidence.matchKind === 'parent')) return 'parent';
  return 'exact';
}

function compareReleaseAscending(left: SchemaVersionIdentity, right: SchemaVersionIdentity): number {
  const leftParts = left.release.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.release.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.label.localeCompare(right.label);
}

export function buildSchemaCoverage(analyses: SchemaVersionAnalysis[]): SchemaCoverage {
  const referenceIdentity = new Map<string, { kind: ApiKind; path: string }>();
  for (const analysis of analyses) {
    for (const reference of analysis.references) {
      const key = referenceKey(reference.kind, reference.path);
      referenceIdentity.set(key, { kind: reference.kind, path: reference.path });
    }
  }

  const references = [...referenceIdentity.entries()]
    .map(([key, identity]): ReferenceSchemaCoverage => {
      const exactVersions: SchemaVersionIdentity[] = [];
      const parentVersions: SchemaVersionIdentity[] = [];
      const missingVersions: SchemaVersionIdentity[] = [];
      for (const analysis of analyses) {
        const matchKind = matchKindFor(analysis, key);
        if (matchKind === 'exact') exactVersions.push(analysis.version);
        else if (matchKind === 'parent') parentVersions.push(analysis.version);
        else missingVersions.push(analysis.version);
      }
      return { key, ...identity, exactVersions, parentVersions, missingVersions };
    })
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.path.localeCompare(right.path));

  const versionCoverage = analyses.map(({ version }): VersionSchemaCoverage => {
    const parentReferences = references
      .filter((reference) =>
        reference.parentVersions.some((candidate) => candidate.id === version.id),
      )
      .map(({ key, kind, path }) => ({ key, kind, path }));
    const missingReferences = references
      .filter((reference) =>
        reference.missingVersions.some((candidate) => candidate.id === version.id),
      )
      .map(({ key, kind, path }) => ({ key, kind, path }));
    const parentPathCount = parentReferences.length;
    const missingPathCount = missingReferences.length;
    const exactPathCount = references.length - parentPathCount - missingPathCount;
    return {
      ...version,
      status: missingPathCount > 0
        ? 'missing'
        : parentPathCount > 0
          ? 'parent-warning'
          : 'exact',
      exactPathCount,
      parentPathCount,
      missingPathCount,
      parentReferences,
      missingReferences,
    };
  });

  const compatibleVersions = versionCoverage.filter((version) => version.missingPathCount === 0);
  const sortedCompatibleVersions = [...compatibleVersions].sort(compareReleaseAscending);
  const sortedCatalogVersions = [...versionCoverage].sort(compareReleaseAscending);
  const earliestCompatibleVersion = references.length > 0
    ? sortedCompatibleVersions[0] ?? null
    : null;
  const latestCompatibleVersion = references.length > 0
    ? sortedCompatibleVersions.at(-1) ?? null
    : null;
  const latestCatalogVersion = sortedCatalogVersions.at(-1) ?? null;
  const compatibilityByChannel = (['cloud', 'on-premises'] as const).map((channel) => {
    const channelVersions = versionCoverage
      .filter((version) => version.channel === channel)
      .sort(compareReleaseAscending);
    const compatibleChannelVersions = channelVersions
      .filter((version) => version.missingPathCount === 0);
    const earliest = references.length > 0
      ? compatibleChannelVersions[0] ?? null
      : null;
    const latest = references.length > 0
      ? compatibleChannelVersions.at(-1) ?? null
      : null;
    return {
      channel,
      earliestCompatibleVersion: earliest,
      latestCompatibleVersion: latest,
      latestCatalogVersion: channelVersions.at(-1) ?? null,
      laterIncompatibleVersions: earliest
        ? channelVersions.filter((version) =>
          version.missingPathCount > 0 && compareReleaseAscending(version, earliest) > 0)
        : [],
    };
  });
  return {
    totalVersions: analyses.length,
    totalReferences: references.length,
    compatibleVersions,
    exactCompatibleVersions: compatibleVersions.filter((version) => version.status === 'exact'),
    parentWarningVersions: compatibleVersions.filter((version) => version.status === 'parent-warning'),
    incompatibleVersions: versionCoverage.filter((version) => version.missingPathCount > 0),
    earliestCompatibleVersion,
    latestCompatibleVersion,
    latestCatalogVersion,
    compatibilityByChannel,
    references,
  };
}
