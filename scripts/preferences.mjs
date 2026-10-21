import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { SEARCH_ENGINES } from '../src/navigation.js';

const valid = value => SEARCH_ENGINES.some(engine => engine.id === value);

export class Preferences {
  constructor(file = '.local/browser-settings.json') {
    this.file = file;
    try { const data = JSON.parse(readFileSync(file, 'utf8')); this.searchEngine = valid(data.searchEngine) ? data.searchEngine : 'google'; }
    catch { this.searchEngine = 'google'; }
  }
  setSearchEngine(value) {
    if (!valid(value)) throw Error('Selecciona uno de los buscadores disponibles.');
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    writeFileSync(temporary, JSON.stringify({ searchEngine: value }, null, 2) + '\n', { mode: 0o600 });
    renameSync(temporary, this.file);
    this.searchEngine = value;
  }
}
