import snapshot from './anime-classics-data.js';
export const CLASSIC_INFO={source:snapshot.source,sourceURL:snapshot.sourceURL,capturedAt:snapshot.capturedAt,cutoffYear:snapshot.cutoffYear,count:snapshot.items.length};
const key=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function classicAnimeRow(items=[]) {
 const index=new Map();
 for(const item of items.filter(item=>item.kind==='anime')){const name=key(item.title);if(!index.has(name))index.set(name,[]);index.get(name).push(item);}
 return {id:'anime-classics-top100',title:'Anime clásico · Top 100 AniList · hasta 2006',layout:'poster',note:'Puntuación AniList · más de 10 000 usuarios · '+new Date(snapshot.capturedAt).toLocaleDateString('es-MX',{timeZone:'America/Mexico_City'}),
  items:snapshot.items.map(entry=>{
   const found=entry.aliases.flatMap(alias=>index.get(key(alias))||[]).filter(item=>Number(item.year)===entry.year).sort((a,b)=>Number(!!b.isShow)-Number(!!a.isShow))[0];
   const metadata={classicRank:entry.rank,badge:'TOP '+entry.rank,classicYear:entry.year,classicScore:entry.score,classicSource:entry.url,classicQuery:entry.english||entry.title};
   return found?{...found,...metadata}:{...metadata,kind:'anime',source:'anilist',url:'holy:classic:'+entry.id,title:entry.english||entry.title,year:String(entry.year),poster:entry.poster,genres:[],discover:true,subtitle:'AniList '+entry.score+'/100 · '+entry.year+' · Buscar en tus sitios',overview:'Ficha de referencia de AniList. Busca el título para comprobar su disponibilidad y la versión en tus sitios.'};
  })};
}
