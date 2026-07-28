import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface CatalogSnapshot {
  release: string;
  label: string;
  channel: 'cloud' | 'on-premises';
  operatingModes: Array<'Native' | 'MTR'>;
}

interface SchemaCatalog {
  source: {
    repository: string;
    branch: string;
    path: string;
  };
  snapshots: CatalogSnapshot[];
  quarantined: unknown[];
}

const catalog = JSON.parse(readFileSync(
  new URL('../public/schemas/catalog.json', import.meta.url),
  'utf8',
)) as SchemaCatalog;
const monthPattern = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i;

describe('RoomOS schema catalog', () => {
  it('records the Cisco schema repository as its upstream source', () => {
    expect(catalog.source).toEqual({
      repository: 'https://github.com/cisco-ce/roomos.cisco.com',
      branch: 'master',
      path: 'schemas',
    });
    expect(catalog.snapshots.length).toBeGreaterThan(30);
    expect(catalog.quarantined).toEqual([]);
  });

  it('classifies month-labelled schemas as Cloud and all others as On-premises', () => {
    const cloud = catalog.snapshots.filter((snapshot) => snapshot.channel === 'cloud');
    const onPremises = catalog.snapshots.filter((snapshot) => snapshot.channel === 'on-premises');

    expect(cloud.length).toBeGreaterThan(0);
    expect(onPremises.length).toBeGreaterThan(0);
    expect(cloud.every((snapshot) => monthPattern.test(snapshot.label))).toBe(true);
    expect(onPremises.every((snapshot) => !monthPattern.test(snapshot.label))).toBe(true);
  });

  it('lists Android Container support only for schemas with availability metadata', () => {
    const nativeOnly = catalog.snapshots
      .filter((snapshot) => !snapshot.operatingModes.includes('MTR'))
      .map((snapshot) => snapshot.release)
      .sort();

    expect(nativeOnly).toEqual(['10.19.4.2', '9.15.17.4']);
    expect(catalog.snapshots.every((snapshot) =>
      snapshot.operatingModes[0] === 'Native')).toBe(true);
  });
});
