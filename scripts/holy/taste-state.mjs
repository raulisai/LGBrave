import {genreLabel} from '../../src/holy-genres.js';
// Portable merge rules. Retain deletion markers so old devices cannot revive removed tastes.
export const normalizeTaste = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const tasteKey = item => [normalizeTaste(item?.title) || item?.show || item?.url || '', item?.kind || 'show', item?.kind === 'movie' ? String(item?.year || '') : ''].join('|');
export function publicTasteURL(value) {
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&![...url.searchParams.keys()].some(key=>/token|auth|password|secret|signature|session|api.?key/i.test(key))?url.origin+url.pathname+url.search:'';}catch{return '';}
}
export const prefKey = pref => pref.type + '|' + normalizeTaste(pref.type === 'genre' ? genreLabel(pref.name) : pref.name);
const stamp = value => Number.isFinite(value) && value >= 0 ? Math.min(value, 31536000000000) : 0;
export function cleanLanguages(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value).filter(([key,item])=>publicTasteURL(key)&&key.length<=2048&&item&&typeof item.id==='string'&&item.id&&['dub','sub','orig'].includes(item.kind)).sort((a,b)=>stamp(b[1].at)-stamp(a[1].at)||a[0].localeCompare(b[0])).slice(0,300)
    .map(([key,item])=>[key,{id:item.id.slice(0,40),kind:item.kind,label:String(item.label||'').slice(0,80),at:stamp(item.at)}]));
}
export function cleanTasteMeta(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const markers = input => Object.fromEntries(Object.entries(input && typeof input === 'object' ? input : {}).filter(([key, at]) => key.length <= 2048 && stamp(at) > 0 && !/https?:|token=|secret=|password=|signature=/i.test(key)).sort((a,b) => b[1]-a[1]).slice(0, 2000).map(([key, at]) => [key, stamp(at)]));
  // Entry keys are public source URLs and are separately checked by the profile transport.
  const removedEntries = Object.fromEntries(Object.entries(value.removedEntries || {}).filter(([key, at]) => publicTasteURL(key) && key.length <= 2048 && stamp(at) > 0).slice(-600).map(([key, at]) => [key, stamp(at)]));
  const removedLanguages=Object.fromEntries(Object.entries(value.removedLanguages||{}).filter(([key,at])=>publicTasteURL(key)&&key.length<=2048&&stamp(at)>0).sort((a,b)=>b[1]-a[1]).slice(0,300).map(([key,at])=>[key,stamp(at)]));
  return { removedLanguages, clock: stamp(value.clock), resetAt: stamp(value.resetAt), removedVotes: markers(value.removedVotes), removedPrefs: markers(value.removedPrefs), removedEntries };
}
const mergeMarkers = (a, b) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(key => [key, Math.max(a[key] || 0, b[key] || 0)]));
const newest = (items, keyOf, field) => {
  const found = new Map();
  for (const item of items) {
    const key = keyOf(item), before = found.get(key);
    if (!before || (item[field] || 0) > (before[field] || 0) || ((item[field] || 0) === (before[field] || 0) && JSON.stringify(item) > JSON.stringify(before))) found.set(key, item);
  }
  return [...found.values()].sort((a,b) => (b[field] || 0) - (a[field] || 0) || (keyOf(a)<keyOf(b)?-1:keyOf(a)>keyOf(b)?1:0));
};
export function mergeLibraryState(left, right) {
  const a = cleanTasteMeta(left.tasteMeta), b = cleanTasteMeta(right.tasteMeta);
  const tasteMeta = cleanTasteMeta({ clock: Math.max(a.clock,b.clock,a.resetAt,b.resetAt,...[...(left.votes||[]),...(right.votes||[]),...(left.prefs||[]),...(right.prefs||[]),...Object.values(cleanLanguages(left.languages)),...Object.values(cleanLanguages(right.languages))].map(item=>stamp(item.at))), resetAt: Math.max(a.resetAt, b.resetAt),
    removedVotes: mergeMarkers(a.removedVotes, b.removedVotes), removedPrefs: mergeMarkers(a.removedPrefs, b.removedPrefs), removedEntries: mergeMarkers(a.removedEntries, b.removedEntries), removedLanguages: mergeMarkers(a.removedLanguages,b.removedLanguages) });
  const survives = (item, key, removed, field) => (!tasteMeta.resetAt || item[field] > tasteMeta.resetAt) && (!removed[key] || item[field] > removed[key]);
  const languageItems=newest([...Object.entries(cleanLanguages(left.languages)),...Object.entries(cleanLanguages(right.languages))].map(([key,item])=>({key,...item})),item=>item.key,'at');
  const languages=Object.fromEntries(languageItems.filter(item=>!tasteMeta.removedLanguages[item.key]||item.at>tasteMeta.removedLanguages[item.key]).slice(0,300).map(({key,...item})=>[key,item]));
  return { tasteMeta, languages,
    votes: newest([...(left.votes || []), ...(right.votes || [])], tasteKey, 'at').filter(item => survives(item, tasteKey(item), tasteMeta.removedVotes, 'at')).slice(0, 500),
    prefs: newest([...(left.prefs || []), ...(right.prefs || [])], prefKey, 'at').filter(item => survives(item, prefKey(item), tasteMeta.removedPrefs, 'at')).slice(0, 1000),
    entries: newest([...(left.entries || []), ...(right.entries || [])], item => item.key, 'updatedAt').filter(item => !tasteMeta.removedEntries[item.key] || item.updatedAt > tasteMeta.removedEntries[item.key]).slice(0, 300),
    asked: mergeMarkers(left.asked || {}, right.asked || {})
  };
}
