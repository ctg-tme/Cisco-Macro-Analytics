import { describe, expect, it, vi } from 'vitest';
import { loadVerifiedSchema, type CatalogSnapshot } from './schemaCatalog';

const snapshot: CatalogSnapshot = {
  id: 'roomos-test',
  release: '26.7.1',
  label: '26.7.1 June 2026',
  channel: 'cloud',
  lastUpdated: '2026-07-01T00:00:00.000Z',
  filename: '26.7.1 June 2026.json',
  sha256: '736520c9db846d6eb9b018e064d7db14c108b04d27d92032fe34dd4a34710741',
  byteSize: 14,
  objectCount: 0,
  products: [],
  roles: [],
  operatingModes: ['Native'],
};

describe('verified RoomOS schema loading', () => {
  it('attaches catalog provenance only after the exact fetched bytes match', async () => {
    const fetchSchema = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"objects":[]}', { status: 200 }),
    );

    const loaded = await loadVerifiedSchema(snapshot, '/schemas/', fetchSchema);

    expect(fetchSchema).toHaveBeenCalledWith(
      '/schemas/26.7.1%20June%202026.json',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(loaded.schema.sha256).toBe(snapshot.sha256);
    expect(loaded.provenance).toEqual(expect.objectContaining({
      schemaId: snapshot.id,
      expectedSha256: snapshot.sha256,
      actualSha256: snapshot.sha256,
      verified: true,
    }));
  });

  it('fails closed when fetched content does not match the catalog hash', async () => {
    const fetchSchema = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"objects":[]}\n', { status: 200 }),
    );

    await expect(loadVerifiedSchema(snapshot, '/schemas/', fetchSchema)).rejects.toThrow(
      new RegExp(
        `RoomOS schema ${snapshot.label} failed SHA-256 verification.*expected ${snapshot.sha256}.*actual [a-f0-9]{64}`,
        'i',
      ),
    );
  });

  it('rejects missing hash metadata before any schema request', async () => {
    const fetchSchema = vi.fn<typeof fetch>();

    await expect(loadVerifiedSchema(
      { ...snapshot, sha256: '' },
      '/schemas/',
      fetchSchema,
    )).rejects.toThrow(`RoomOS schema ${snapshot.label} is missing a valid catalog SHA-256 hash.`);
    expect(fetchSchema).not.toHaveBeenCalled();
  });

  it('identifies the schema when the network request fails', async () => {
    const fetchSchema = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(loadVerifiedSchema(snapshot, '/schemas/', fetchSchema)).rejects.toThrow(
      `RoomOS schema ${snapshot.label} could not be fetched: Failed to fetch. Verify network access and retry.`,
    );
  });

  it('rejects invalid JSON even when the fetched bytes match their catalog hash', async () => {
    const fetchSchema = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('not-json', { status: 200 }),
    );

    await expect(loadVerifiedSchema(
      {
        ...snapshot,
        sha256: '0c21a879c732a67910d80988df4919d794f6a070aab610ef865032a28046b021',
      },
      '/schemas/',
      fetchSchema,
    )).rejects.toThrow(
      `RoomOS schema ${snapshot.label} passed byte verification but is not valid JSON.`,
    );
  });

  it('re-verifies cached response bytes instead of trusting cache metadata', async () => {
    const fetchSchema = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"objects":[]}\n', {
        status: 200,
        headers: { Age: '120', 'X-Cache': 'HIT' },
      }),
    );

    await expect(loadVerifiedSchema(snapshot, '/schemas/', fetchSchema)).rejects.toThrow(
      /failed SHA-256 verification/i,
    );
  });
});
