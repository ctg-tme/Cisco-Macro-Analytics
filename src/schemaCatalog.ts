import type { SchemaObject, SchemaSnapshot } from './analysis/types';

export interface CatalogSnapshot {
  id: string;
  release: string;
  label: string;
  channel: 'cloud' | 'on-premises';
  lastUpdated: string;
  filename: string;
  sha256: string;
  byteSize: number;
  objectCount: number;
  products: string[];
  roles: string[];
  operatingModes: Array<'Native' | 'MTR'>;
}

export interface VerifiedSchemaProvenance {
  schemaId: string;
  release: string;
  filename: string;
  upstreamUpdatedAt: string;
  expectedSha256: string;
  actualSha256: string;
  byteSize: number;
  verified: true;
}

export interface VerifiedSchema {
  schema: SchemaSnapshot;
  provenance: VerifiedSchemaProvenance;
}

function hexadecimal(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  return hexadecimal(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

export async function loadVerifiedSchema(
  snapshot: CatalogSnapshot,
  schemaBaseUrl: string,
  fetchSchema: typeof fetch = fetch,
): Promise<VerifiedSchema> {
  if (!/^[a-f0-9]{64}$/i.test(snapshot.sha256)) {
    throw new Error(`RoomOS schema ${snapshot.label} is missing a valid catalog SHA-256 hash.`);
  }
  let response: Response;
  try {
    response = await fetchSchema(
      `${schemaBaseUrl}${encodeURIComponent(snapshot.filename)}`,
      { cache: 'no-store' },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown network error';
    throw new Error(
      `RoomOS schema ${snapshot.label} could not be fetched: ${detail}. Verify network access and retry.`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(`RoomOS schema ${snapshot.label} request failed with HTTP ${response.status}.`);
  }

  const bytes = await response.arrayBuffer();
  const actualSha256 = await sha256(bytes);
  if (actualSha256 !== snapshot.sha256.toLowerCase()) {
    throw new Error(
      `RoomOS schema ${snapshot.label} failed SHA-256 verification: expected ${snapshot.sha256}, actual ${actualSha256}. Refresh the schema catalog or restore the published snapshot before retrying.`,
    );
  }
  let parsed: { objects?: SchemaObject[] };
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as { objects?: SchemaObject[] };
  } catch (error) {
    throw new Error(
      `RoomOS schema ${snapshot.label} passed byte verification but is not valid JSON.`,
      { cause: error },
    );
  }
  if (!Array.isArray(parsed.objects) || parsed.objects.length !== snapshot.objectCount) {
    throw new Error(`RoomOS schema ${snapshot.label} did not match its catalog object count.`);
  }

  return {
    schema: {
      id: snapshot.id,
      release: snapshot.release,
      sha256: actualSha256,
      objectCount: snapshot.objectCount,
      objects: parsed.objects,
      upstreamUpdatedAt: snapshot.lastUpdated,
    },
    provenance: {
      schemaId: snapshot.id,
      release: snapshot.release,
      filename: snapshot.filename,
      upstreamUpdatedAt: snapshot.lastUpdated,
      expectedSha256: snapshot.sha256,
      actualSha256,
      byteSize: bytes.byteLength,
      verified: true,
    },
  };
}
