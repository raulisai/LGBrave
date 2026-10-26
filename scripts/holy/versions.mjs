// Versions of a title (audio and subtitles) offered by a site: «Español latino», «Coreano ·
// subtítulos en español»… A connector with `versions(entry, load)` returns them, each with the
// player target for that version; the catalogue picks one (the owner's choice, else the first).
// kind: dub = Spanish audio · sub = original audio with Spanish subtitles · orig = original only.
export const KIND_LABEL = { dub: 'En español', sub: 'Subtítulos en español', orig: 'Idioma original' };

// A version as the screens see it (without its player).
export const publicVersion = version => ({ id: String(version.id), label: String(version.label), kind: ['dub', 'sub', 'orig'].includes(version.kind) ? version.kind : 'orig' });

// The version asked for by id, else the first of the same kind, else null (nothing matches).
export function matchVersion(versions, { id, kind } = {}) {
  const list = Array.isArray(versions) ? versions : [];
  return list.find(version => id && String(version.id) === String(id)) || (kind && list.find(version => version.kind === kind)) || null;
}

// Several different versions of the same kind are told apart by their label; groups with the same id are merged.
export function dedupe(versions) {
  const seen = new Map();
  for (const version of versions) {
    if (!version?.target?.url) continue;
    const key = String(version.id);
    if (!seen.has(key)) seen.set(key, version);
  }
  return [...seen.values()];
}
