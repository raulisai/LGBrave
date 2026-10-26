import {readFileSync,existsSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {CONNECTORS} from './holy/connectors.mjs';
import {ROOT} from './desktop-config.mjs';

export const MATRIX_FILE='scripts/fixtures/playback/known-cases.json';
export function validatePlaybackMatrix(matrix,{exists=path=>existsSync(resolve(ROOT,path)),runner=readFileSync(resolve(ROOT,'scripts/test-local.mjs'),'utf8'),sources=CONNECTORS.map(s=>s.id)}={}) {
  if(matrix?.version!==1||!Array.isArray(matrix.cases)||!matrix.cases.length)throw Error('Falta la matriz de reproducción.');
  const ids=new Set(),covered=new Set();
  const safeFile=path=>typeof path==='string'&&!path.includes('\\')&&!path.split('/').includes('..')&&!path.includes(':')&&!path.startsWith('/')&&exists(path);
  for(const row of matrix.cases){
    if(!row?.id||ids.has(row.id))throw Error('Caso sin ID único.');
    ids.add(row.id);
    if(!['controlled','tv-user-confirmed','tv-metrics','desktop-http','navigation-only'].includes(row.scope))throw Error('Alcance desconocido: '+row.id);
    if(!Array.isArray(row.sources)||row.sources.some(s=>!sources.includes(s)))throw Error('Fuente desconocida: '+row.id);
    if(!row.description||!Array.isArray(row.evidence)||!row.evidence.length||row.evidence.some(p=>!safeFile(p)))throw Error('Evidencia ausente: '+row.id);
    if(!Array.isArray(row.tests)||!row.tests.length||row.tests.some(p=>!safeFile(p)||!/^scripts\/test-[\w-]+\.mjs$/.test(p)||!runner.includes("'"+p.slice(8,-4)+"'")))throw Error('Regresión fuera de la suite: '+row.id);
    if(row.scope==='controlled'&&row.id.startsWith('source-'))for(const id of row.sources)covered.add(id);
  }
  if(sources.some(id=>!covered.has(id)))throw Error('Toda fuente debe tener contrato controlado.');
  return {cases:matrix.cases.length,sources:covered.size,scopes:Object.fromEntries([...new Set(matrix.cases.map(c=>c.scope))].map(scope=>[scope,matrix.cases.filter(c=>c.scope===scope).length]))};
}
export const loadPlaybackMatrix=()=>JSON.parse(readFileSync(resolve(ROOT,MATRIX_FILE),'utf8'));
