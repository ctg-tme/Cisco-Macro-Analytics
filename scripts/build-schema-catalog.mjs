import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = path.join(projectRoot, 'xapiSchemas');
const outputDirectory = path.join(projectRoot, 'public', 'schemas');
const monthPattern = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i;
const teamsUnavailableStatePattern =
  /(?:^|;)(?:MicrosoftTeamsInstalled|MicrosoftTeamsInCall)(?:;|$)/;

function releaseFromFilename(filename) {
  return filename.replace(/\.json$/i, '').split(' ')[0];
}

function releaseParts(release) {
  return release.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

function compareReleases(left, right) {
  const a = releaseParts(left.release);
  const b = releaseParts(right.release);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (b[index] ?? 0) - (a[index] ?? 0);
  }
  return left.filename.localeCompare(right.filename);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function channelFromLabel(label) {
  return monthPattern.test(label) ? 'cloud' : 'on-premises';
}

function hasAndroidContainerMetadata(objects) {
  return objects.some((object) => {
    if (object.attributes?.include_for_extension === 'mtr') return true;
    const unavailableStates = object.attributes?.unavailableStates;
    return object.type === 'Command'
      && typeof unavailableStates === 'string'
      && teamsUnavailableStatePattern.test(unavailableStates);
  });
}

const upstreamManifest = JSON.parse(await readFile(
  path.join(sourceDirectory, 'roomosSchemaManifest.json'),
  'utf8',
));
const upstreamByName = new Map(
  upstreamManifest
    .filter((entry) => entry && typeof entry.name === 'string')
    .map((entry) => [entry.name, entry]),
);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const filenames = (await readdir(sourceDirectory))
  .filter((filename) => filename.endsWith('.json'))
  .filter((filename) => filename !== 'roomosSchemaManifest.json')
  .filter((filename) => !filename.startsWith('sample-'))
  .sort();

const snapshots = [];
const quarantined = [];

for (const filename of filenames) {
  const sourcePath = path.join(sourceDirectory, filename);
  try {
    const bytes = await readFile(sourcePath);
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(parsed.objects) || parsed.objects.length < 100) {
      quarantined.push({ filename, reason: 'Expected a schema with at least 100 objects.' });
      continue;
    }
    const malformedObject = parsed.objects.find((object) =>
      !object || typeof object.path !== 'string' || typeof object.type !== 'string',
    );
    if (malformedObject) {
      quarantined.push({ filename, reason: 'At least one schema object is missing a path or type.' });
      continue;
    }

    const label = filename.replace(/\.json$/i, '');
    const release = releaseFromFilename(filename);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const snapshotFilename = `${sha256.slice(0, 12)}-${release}.json`;
    await copyFile(sourcePath, path.join(outputDirectory, snapshotFilename));
    const fileStat = await stat(sourcePath);
    snapshots.push({
      id: `roomos-${release}-${sha256.slice(0, 12)}`,
      release,
      label,
      channel: channelFromLabel(label),
      lastUpdated: upstreamByName.get(label)?.lastUpdated,
      filename: snapshotFilename,
      sha256,
      byteSize: fileStat.size,
      objectCount: parsed.objects.length,
      products: unique(parsed.objects.flatMap((object) => object.products ?? [])),
      roles: unique(parsed.objects.flatMap((object) => object.attributes?.role ?? [])),
      operatingModes: hasAndroidContainerMetadata(parsed.objects)
        ? ['Native', 'MTR']
        : ['Native'],
    });
  } catch (error) {
    quarantined.push({ filename, reason: error instanceof Error ? error.message : 'Unknown validation error.' });
  }
}

snapshots.sort(compareReleases);
const catalog = {
  schemaVersion: '1.0.0',
  selectionPolicy: 'All validated snapshots are analyzed; reports remain pinned to each SHA-256 hash.',
  source: {
    repository: 'https://github.com/cisco-ce/roomos.cisco.com',
    branch: 'master',
    path: 'schemas',
  },
  snapshots,
  quarantined,
};

await writeFile(
  path.join(outputDirectory, 'catalog.json'),
  `${JSON.stringify(catalog, null, 2)}\n`,
  'utf8',
);

console.log(`Schema Catalog: ${snapshots.length} validated, ${quarantined.length} quarantined.`);
