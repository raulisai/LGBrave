// Refreshes the committed snapshot of well-known lists (awards, critics' polls, countries and anime
// charts) used when a computer starts without Internet. Usage: npm run holy:lists:update [id…]
// (only those lists, e.g. «oscar bfi»; the rest keep what the cache has).
import { writeFileSync } from 'node:fs';
import { KnownLists, LISTS, compactEntry } from './holy/known-lists.mjs';

const only = process.argv.slice(2);
const lists = new KnownLists({ file: '.local/holy-known-lists.json', log: console.log, lists: only.length ? LISTS.filter(list => only.includes(list.id)) : LISTS });
const read = await lists.refresh({ force: true });
const all = new KnownLists({ file: '.local/holy-known-lists.json' });
const target = new URL('./holy/known-lists-snapshot.json', import.meta.url);
const snapshot = Object.fromEntries(LISTS.filter(list => all.data.lists[list.id]).map(list => [list.id, { ...all.data.lists[list.id], entries: all.data.lists[list.id].entries.map(compactEntry) }]));
// One entry per line: small, and a refresh reads as a short diff.
const lines = Object.entries(snapshot).map(([id, { entries, ...list }]) => `  ${JSON.stringify(id)}: ${JSON.stringify(list).slice(0, -1)}, "entries": [\n${entries.map(entry => '   ' + JSON.stringify(entry)).join(',\n')}\n  ]}`);
writeFileSync(target, `{"capturedAt": ${JSON.stringify(new Date().toISOString())}, "lists": {\n${lines.join(',\n')}\n}}\n`);
for (const [id, list] of Object.entries(snapshot)) console.log(`${id}: ${list.entries.length} (${list.source})`);
console.log(`${read} listas leídas → ${target.pathname}`);
