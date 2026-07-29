import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const distDirectory = resolve('dist');
const assetsDirectory = resolve(distDirectory, 'assets');
const serviceWorkerPath = resolve(distDirectory, 'sw.js');
const assetEntries = await readdir(assetsDirectory, { withFileTypes: true });
const assets = assetEntries
  .filter((entry) => entry.isFile())
  .map((entry) => `/assets/${entry.name}`)
  .sort();
const revision = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12);

let source = await readFile(serviceWorkerPath, 'utf8');
if (!source.includes('__BUILD_REVISION__') || !source.includes('/* __PRECACHE_ASSETS__ */ []')) {
  throw new Error('Service worker precache placeholders are missing');
}
source = source
  .replaceAll('__BUILD_REVISION__', revision)
  .replace('/* __PRECACHE_ASSETS__ */ []', JSON.stringify(assets, null, 2));
await writeFile(serviceWorkerPath, source);

console.log(`Finalized service worker ${revision} with ${assets.length} hashed assets`);
