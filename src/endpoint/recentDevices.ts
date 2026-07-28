export interface RecentEndpoint {
  host: string;
  broadcastName: string;
}

interface BrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const RECENT_ENDPOINTS_STORAGE_KEY = 'cisco-macro-analyzer-recent-endpoints';
export const MAX_RECENT_ENDPOINTS = 5;

function cleanRecentEndpoint(value: unknown): RecentEndpoint | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.host !== 'string' || typeof record.broadcastName !== 'string') {
    return undefined;
  }

  const host = record.host.trim();
  const broadcastName = record.broadcastName.trim();
  if (!host || !broadcastName || host.length > 512 || broadcastName.length > 512) {
    return undefined;
  }
  return { host, broadcastName };
}

export function updateRecentEndpoints(
  current: RecentEndpoint[],
  endpoint: RecentEndpoint,
): RecentEndpoint[] {
  const cleaned = cleanRecentEndpoint(endpoint);
  if (!cleaned) return current.slice(0, MAX_RECENT_ENDPOINTS);
  const endpointKey = cleaned.host.toLowerCase();
  return [
    cleaned,
    ...current.filter((item) => item.host.toLowerCase() !== endpointKey),
  ].slice(0, MAX_RECENT_ENDPOINTS);
}

export function parseRecentEndpoints(value: string | null): RecentEndpoint[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.reduce<RecentEndpoint[]>((recent, item) => {
      const endpoint = cleanRecentEndpoint(item);
      if (
        !endpoint
        || recent.some((saved) => saved.host.toLowerCase() === endpoint.host.toLowerCase())
        || recent.length >= MAX_RECENT_ENDPOINTS
      ) {
        return recent;
      }
      recent.push(endpoint);
      return recent;
    }, []);
  } catch {
    return [];
  }
}

function resolveStorage(storage?: BrowserStorage): BrowserStorage | undefined {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadRecentEndpoints(storage?: BrowserStorage): RecentEndpoint[] {
  try {
    return parseRecentEndpoints(resolveStorage(storage)?.getItem(RECENT_ENDPOINTS_STORAGE_KEY) ?? null);
  } catch {
    return [];
  }
}

export function saveRecentEndpoint(
  endpoint: RecentEndpoint,
  storage?: BrowserStorage,
): RecentEndpoint[] {
  const target = resolveStorage(storage);
  const recent = updateRecentEndpoints(loadRecentEndpoints(target), endpoint);
  try {
    target?.setItem(RECENT_ENDPOINTS_STORAGE_KEY, JSON.stringify(recent));
  } catch {
    // The connection remains usable when browser storage is unavailable or full.
  }
  return recent;
}
