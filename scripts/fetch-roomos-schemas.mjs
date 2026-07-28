import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destinationDirectory = path.join(projectRoot, 'xapiSchemas');
const repository = 'cisco-ce/roomos.cisco.com';
const branch = 'master';
const contentsUrl = `https://api.github.com/repos/${repository}/contents/schemas?ref=${branch}`;
const strict = process.env.ROOMOS_SCHEMA_SYNC_STRICT === '1';
const requestHeaders = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'Cisco-Macro-Analyzer-schema-sync',
  ...(process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
};

function gitBlobSha(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`);
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

function validateSchema(bytes, filename) {
  const parsed = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(parsed.objects) || parsed.objects.length < 100) {
    throw new Error(`${filename} did not contain a usable RoomOS schema.`);
  }
  const malformed = parsed.objects.find((object) =>
    !object || typeof object.path !== 'string' || typeof object.type !== 'string',
  );
  if (malformed) {
    throw new Error(`${filename} contains an object without a path or type.`);
  }
}

async function responseJson(url) {
  const response = await fetch(url, { headers: requestHeaders });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response.json();
}

async function downloadBytes(url) {
  const response = await fetch(url, { headers: requestHeaders });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

async function syncSchemas() {
  await mkdir(destinationDirectory, { recursive: true });
  const contents = await responseJson(contentsUrl);
  if (!Array.isArray(contents)) throw new Error('The upstream schemas directory was not a file listing.');

  const files = new Map(
    contents
      .filter((entry) => entry?.type === 'file' && typeof entry.name === 'string')
      .map((entry) => [entry.name, entry]),
  );
  const manifestFile = files.get('schemas.json');
  if (!manifestFile?.download_url) throw new Error('The upstream schema manifest is missing.');

  const manifestBytes = await downloadBytes(manifestFile.download_url);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (!Array.isArray(manifest)) throw new Error('The upstream schema manifest was not an array.');
  const activeSchemas = manifest.filter((entry) =>
    entry?.active === 1 && typeof entry.name === 'string',
  );
  if (activeSchemas.length < 10) {
    throw new Error(`The upstream manifest only listed ${activeSchemas.length} active schemas.`);
  }

  let downloaded = 0;
  let unchanged = 0;
  for (const schema of activeSchemas) {
    const filename = `${schema.name}.json`;
    const remote = files.get(filename);
    if (!remote?.download_url || typeof remote.sha !== 'string') {
      throw new Error(`The upstream repository does not contain ${filename}.`);
    }

    const destination = path.join(destinationDirectory, filename);
    try {
      const existing = await readFile(destination);
      if (gitBlobSha(existing) === remote.sha) {
        unchanged += 1;
        continue;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    const bytes = await downloadBytes(remote.download_url);
    validateSchema(bytes, filename);
    if (gitBlobSha(bytes) !== remote.sha) {
      throw new Error(`${filename} did not match its upstream Git blob SHA.`);
    }

    const temporaryPath = `${destination}.tmp`;
    try {
      await writeFile(temporaryPath, bytes);
      await rename(temporaryPath, destination);
    } finally {
      await unlink(temporaryPath).catch(() => {});
    }
    downloaded += 1;
  }

  await writeFile(
    path.join(destinationDirectory, 'roomosSchemaManifest.json'),
    `${JSON.stringify(activeSchemas, null, 2)}\n`,
    'utf8',
  );
  console.log(
    `RoomOS schema sync: ${activeSchemas.length} active from ${repository}; `
    + `${downloaded} downloaded, ${unchanged} unchanged.`,
  );
}

try {
  await syncSchemas();
} catch (error) {
  const localSchemas = (await readdir(destinationDirectory).catch(() => []))
    .filter((filename) =>
      filename.endsWith('.json')
      && filename !== 'roomosSchemaManifest.json'
      && !filename.startsWith('sample-'),
    );
  const message = error instanceof Error ? error.message : 'Unknown schema sync error.';
  if (strict || localSchemas.length === 0) throw error;
  console.warn(
    `RoomOS schema sync unavailable (${message}) Using ${localSchemas.length} local `
    + 'last-known-good schemas.',
  );
}
