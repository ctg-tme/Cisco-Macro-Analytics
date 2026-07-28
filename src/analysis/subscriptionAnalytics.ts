import type { ApiKind, ApiReference } from './types';

export interface SubscriptionBranchSummary {
  totalRegistrations: number;
  uniqueSubscribedPaths: number;
}

export interface SubscriptionAnalytics {
  totalRegistrations: number;
  uniqueSubscribedPaths: number;
  duplicateRegistrations: number;
  byBranch: Record<ApiKind, SubscriptionBranchSummary>;
}

const apiKinds: ApiKind[] = ['Command', 'Configuration', 'Status', 'Event'];

export function summarizeSubscriptions(references: ApiReference[]): SubscriptionAnalytics {
  const subscriptions = references.filter((reference) => reference.operation === 'subscribe');
  const unique = new Set(subscriptions.map((reference) => `${reference.kind}|${reference.path}`));
  const byBranch = Object.fromEntries(apiKinds.map((kind) => {
    const branchReferences = subscriptions.filter((reference) => reference.kind === kind);
    return [kind, {
      totalRegistrations: branchReferences.length,
      uniqueSubscribedPaths: new Set(branchReferences.map((reference) => reference.path)).size,
    }];
  })) as Record<ApiKind, SubscriptionBranchSummary>;

  return {
    totalRegistrations: subscriptions.length,
    uniqueSubscribedPaths: unique.size,
    duplicateRegistrations: subscriptions.length - unique.size,
    byBranch,
  };
}
