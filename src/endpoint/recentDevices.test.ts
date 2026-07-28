import { describe, expect, it } from 'vitest';
import {
  loadRecentEndpoints,
  MAX_RECENT_ENDPOINTS,
  RECENT_ENDPOINTS_STORAGE_KEY,
  saveRecentEndpoint,
  updateRecentEndpoints,
  type RecentEndpoint,
} from './recentDevices';

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(RECENT_ENDPOINTS_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    value: () => values.get(RECENT_ENDPOINTS_STORAGE_KEY),
  };
}

describe('recent endpoint browser cache', () => {
  it('keeps the five most recent unique hosts and refreshes a reconnected device', () => {
    const endpoints = Array.from({ length: MAX_RECENT_ENDPOINTS }, (_, index) => ({
      host: `room-${index + 1}.example.com`,
      broadcastName: `Room ${index + 1}`,
    }));
    let recent = endpoints.reduce<RecentEndpoint[]>(
      (current, endpoint) => updateRecentEndpoints(current, endpoint),
      [],
    );

    recent = updateRecentEndpoints(recent, {
      host: 'room-2.example.com',
      broadcastName: 'Room 2 renamed',
    });
    recent = updateRecentEndpoints(recent, {
      host: 'room-6.example.com',
      broadcastName: 'Room 6',
    });

    expect(recent).toHaveLength(MAX_RECENT_ENDPOINTS);
    expect(recent[0]).toEqual({
      host: 'room-6.example.com',
      broadcastName: 'Room 6',
    });
    expect(recent[1]).toEqual({
      host: 'room-2.example.com',
      broadcastName: 'Room 2 renamed',
    });
    expect(recent.some((endpoint) => endpoint.host === 'room-1.example.com')).toBe(false);
  });

  it('persists only host addresses and broadcast names', () => {
    const storage = memoryStorage(JSON.stringify([{
      host: 'previous.example.com',
      broadcastName: 'Previous room',
      username: 'stored-user',
      password: 'stored-password',
    }]));

    saveRecentEndpoint({
      host: 'current.example.com',
      broadcastName: 'Current room',
    }, storage);

    expect(storage.value()).toBe(JSON.stringify([
      { host: 'current.example.com', broadcastName: 'Current room' },
      { host: 'previous.example.com', broadcastName: 'Previous room' },
    ]));
    expect(storage.value()).not.toContain('stored-user');
    expect(storage.value()).not.toContain('stored-password');
  });

  it('ignores malformed cache entries and tolerates unavailable storage', () => {
    const storage = memoryStorage(JSON.stringify([
      { host: '', broadcastName: 'Missing host' },
      { host: 'valid.example.com', broadcastName: 'Valid room' },
      { host: 'missing-name.example.com' },
    ]));
    expect(loadRecentEndpoints(storage)).toEqual([
      { host: 'valid.example.com', broadcastName: 'Valid room' },
    ]);

    const unavailable = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadRecentEndpoints(unavailable)).toEqual([]);
    expect(saveRecentEndpoint({
      host: 'session-only.example.com',
      broadcastName: 'Session only',
    }, unavailable)).toEqual([{
      host: 'session-only.example.com',
      broadcastName: 'Session only',
    }]);
  });
});
