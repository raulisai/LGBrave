// Small, dated selections, not live popularity charts or complete copies of either list.
// Source membership was verified 2026-10-25. Match exact aliases AND year to avoid remakes.
export const CURATION = [
  { id: 'afi-thrills', title: 'Famosas del suspense · selección AFI 2001', source: 'https://www.afi.com/afis-100-years-100-thrills/', films: [
    [1960, ['Psycho', 'Psicosis']], [1975, ['Jaws', 'Tiburón']], [1973, ['The Exorcist', 'El exorcista']],
    [1979, ['Alien', 'Alien: el octavo pasajero']], [1980, ['The Shining', 'El resplandor']]
  ] },
  { id: 'bfi-2022', title: 'Entre las mejores · selección Sight and Sound 2022', source: 'https://www.bfi.org.uk/sight-and-sound/greatest-films-all-time', films: [
    [1972, ['The Godfather', 'El padrino']], [1968, ['2001: A Space Odyssey', '2001: Odisea del espacio']],
    [2000, ['In the Mood for Love', 'Deseando amar', 'Con ánimo de amar']],
    [1954, ['Seven Samurai', 'Los siete samuráis', 'Shichinin no samurai']],
    [2001, ['Spirited Away', 'El viaje de Chihiro', 'Sen to Chihiro no Kamikakushi']],
    [2019, ['Parasite', 'Parásitos', 'Gisaengchung']]
  ] }
];
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function curatedRows(items) {
  return CURATION.map(list => ({ id: 'curated-' + list.id, title: list.title, sourceURL: list.source,
    items: list.films.flatMap(([year, aliases]) => items.filter(item => !item.isShow && ['movie', 'anime'].includes(item.kind) && Number(item.year) === year && aliases.some(title => normalize(title) === normalize(item.title))))
  })).filter(row => row.items.length);
}
