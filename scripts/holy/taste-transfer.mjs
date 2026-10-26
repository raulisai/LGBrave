import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { ROOT } from '../desktop-config.mjs';
import { PORT } from './config.mjs';
const [action, file] = process.argv.slice(2);
if (!['export', 'import'].includes(action) || !file) { console.error('Uso: npm run holy:tastes -- export|import archivo.json'); process.exitCode = 1; }
else {
  const url = `http://127.0.0.1:${PORT}/holy-api/taste-profile`;
  try {
    const target = resolve(ROOT, file);
    if (action === 'export' && existsSync(target)) throw Error('El archivo ya existe. Usa otro nombre para conservarlo.');
    const response = await fetch(url, { ...(action === 'import' ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: readFileSync(target, 'utf8') } : {}), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error('El servicio rechazó el perfil (HTTP ' + response.status + ').');
    const result = await response.json();
    if (action === 'export') { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); console.log('Gustos exportados en ' + target); }
    else console.log('Gustos combinados con el perfil activo; confianza ' + result.taste.confidence + '.');
  } catch (error) { console.error('No se pudieron transferir los gustos: ' + (error.cause?.code || error.message)); process.exitCode = 1; }
}
