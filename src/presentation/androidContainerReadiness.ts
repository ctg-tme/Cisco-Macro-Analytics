import type { ApiReference } from '../analysis/types';

type ReadinessReference = Pick<ApiReference, 'kind' | 'path' | 'schemaEvidence'>;

export interface AndroidContainerIssue {
  key: string;
  kind: ApiReference['kind'];
  path: string;
  reason: 'explicitly-unavailable' | 'unknown' | 'not-found';
}

export interface AndroidContainerReadiness {
  total: number;
  available: number;
  unavailable: number;
  unknown: number;
  notFound: number;
  determined: number;
  percentage: number | null;
  issues: AndroidContainerIssue[];
}

export function calculateAndroidContainerReadiness(
  references: readonly ReadinessReference[],
): AndroidContainerReadiness {
  const paths = new Map<string, ReadinessReference[]>();
  for (const reference of references) {
    const key = `${reference.kind}|${reference.path}`;
    const group = paths.get(key) ?? [];
    group.push(reference);
    paths.set(key, group);
  }

  let available = 0;
  let unavailable = 0;
  let unknown = 0;
  let notFound = 0;
  const issues: AndroidContainerIssue[] = [];
  for (const [key, group] of paths) {
    const representative = group[0]!;
    const existsInSnapshot = group.some((reference) => reference.schemaEvidence.existsInSnapshot);
    if (!existsInSnapshot) {
      notFound += 1;
      issues.push({
        key,
        kind: representative.kind,
        path: representative.path,
        reason: 'not-found',
      });
    } else {
      const supportValues = [...new Set(
        group
          .filter((reference) => reference.schemaEvidence.existsInSnapshot)
          .map((reference) => reference.schemaEvidence.operatingMode.supportsMtr),
      )];
      if (supportValues.length === 1 && supportValues[0] === true) {
        available += 1;
      } else if (supportValues.length === 1 && supportValues[0] === false) {
        unavailable += 1;
        issues.push({
          key,
          kind: representative.kind,
          path: representative.path,
          reason: 'explicitly-unavailable',
        });
      } else {
        unknown += 1;
        issues.push({
          key,
          kind: representative.kind,
          path: representative.path,
          reason: 'unknown',
        });
      }
    }
  }

  const total = paths.size;
  const determined = available + unavailable;
  return {
    total,
    available,
    unavailable,
    unknown,
    notFound,
    determined,
    percentage: determined === 0 ? null : Math.round((available / determined) * 100),
    issues,
  };
}
