/* Copy the dashboard's UI libraries from node_modules into dashboard/vendor/ so the dashboard
   runs with no build step and no CDN, at the versions pinned in package-lock.json.
   Usage: npm run vendor */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dashboard', 'vendor');
await mkdir(out, { recursive: true });

const files = [
  ['node_modules/preact/dist/preact.mjs', 'preact.mjs'],
  ['node_modules/preact/hooks/dist/hooks.mjs', 'hooks.mjs'],
  ['node_modules/htm/dist/htm.mjs', 'htm.mjs'],
];
const licenses = [];
for (const [src, dest] of files) {
  // bare "preact" imports become relative, so no import map (and no inline script under the CSP) is needed
  const code = (await readFile(path.join(root, src), 'utf8')).replace(/from\s*"preact"/g, 'from"./preact.mjs"').replace(/\/\/# sourceMappingURL=.*$/m, '');
  await writeFile(path.join(out, dest), code);
  const pkg = src.split('/').slice(1, 2)[0];
  const meta = JSON.parse(await readFile(path.join(root, 'node_modules', pkg, 'package.json'), 'utf8'));
  licenses.push(`${pkg}@${meta.version} — ${meta.license}`);
}
await writeFile(path.join(out, 'LICENSES.txt'), licenses.join('\n') + '\n');
console.log('vendored:', licenses.join(', '));
