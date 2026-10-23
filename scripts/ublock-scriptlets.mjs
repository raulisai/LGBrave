// Child process only: imports uBlock's scriptlets.js (downloaded code) and prints
// them as adblock-rust resources, like Brave's packager does. Started by
// update-lists.mjs with --permission and read access to that copy alone.
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const root = resolve(process.argv[2] || '');
const {builtinScriptlets} = await import(pathToFileURL(resolve(root, 'src/js/resources/scriptlets.js')).href);
if (!Array.isArray(builtinScriptlets) || builtinScriptlets.length < 20) throw Error('scriptlets.js no exporta builtinScriptlets');
const names = new Set(builtinScriptlets.map(entry => entry.name));
const resources = builtinScriptlets.map(entry => {
  if (typeof entry.name !== 'string' || typeof entry.fn !== 'function') throw Error('Scriptlet con formato desconocido');
  for (const dependency of entry.dependencies ?? []) if (!names.has(dependency)) console.error(`Aviso: ${entry.name} depende de ${dependency}, que falta.`);
  return {
    name: entry.name, aliases: entry.aliases ?? [], kind: {mime: 'application/javascript'},
    content: Buffer.from(entry.fn.toString()).toString('base64'), dependencies: entry.dependencies ?? [],
    // uBlock only runs trusted-* scriptlets from trusted lists; Brave marks those lists with bit 1.
    ...(entry.requiresTrust ? {permission: 1} : {})
  };
});
process.stdout.write(JSON.stringify(resources));
