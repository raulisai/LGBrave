import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './desktop-config.mjs';

const files = [];
function collect(directory) {
  for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.isFile() && /\.(?:mjs|js)$/.test(entry.name)) files.push(path);
  }
}
for (const directory of ['src', 'scripts', 'desktop', 'browser']) collect(directory);
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (result.error || result.status !== 0) {
    console.error('Sintaxis incorrecta: ' + file);
    console.error(result.error?.message || result.stderr);
    process.exit(1);
  }
}
console.log(`Sintaxis correcta: ${files.length} archivos JS/MJS; Svelte se verifica en los builds.`);
