// Refreshes the committed snapshot of well-known lists (awards and anime charts) used when
// a computer starts without Internet. Usage: npm run holy:lists:update
import { writeFileSync } from 'node:fs';
import { KnownLists } from './holy/known-lists.mjs';

const lists = new KnownLists({ file: '.local/holy-known-lists.json', log: console.log });
const read = await lists.refresh({ force: true });
const target = new URL('./holy/known-lists-snapshot.json', import.meta.url);
writeFileSync(target, JSON.stringify({ capturedAt: new Date().toISOString(), lists: lists.data.lists }, null, 1) + '\n');
for (const [id, list] of Object.entries(lists.data.lists)) console.log(`${id}: ${list.entries.length} (${list.source})`);
console.log(`${read} listas leídas → ${target.pathname}`);
