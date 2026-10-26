// Real servers and real process lifecycle, with TV and external fetches disabled.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {start,stop,ask} from './desktop-control.mjs';
if(await ask('/status')) throw Error('Ya hay un servicio activo; esta prueba no lo cambiará.');
process.env.LUMA_OFFLINE_TEST='1';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try {
  await start();
  let live;
  for(let n=0;n<80;n++) {live=await ask('/status');if(live?.state==='waiting')break;await sleep(100);}
  assert.equal(live?.state,'waiting');
  for(const [port,path] of [[43187,'/luma-home/'],[43190,'/holy/']]) {
    const response=await fetch(`http://127.0.0.1:${port}${path}`);
    assert.equal(response.status,200,`${port}${path}`);
    const html=await response.text();const asset=html.match(/src="\.\/([^\"]+)"/)[1];
    assert.equal((await fetch(`http://127.0.0.1:${port}${path}${asset}`)).status,200);
  }
  const health=await(await fetch('http://127.0.0.1:43190/holy-api/health')).json();assert.equal(health.tv,'waiting');
  const luma=JSON.parse(readFileSync('dist/appinfo.json'));const holy=JSON.parse(readFileSync('dist-holy/appinfo.json'));
  assert.equal(luma.id,'com.lgapp.lab');assert.equal(holy.id,'com.lgapp.holy');
  await stop();assert.equal(await ask('/status'),null);
  console.log('Servicio real Windows: ambos inicios y sus JS por HTTP, salud Holy y apagado limpio correctos; sin TV ni Internet.');
} finally {await stop();delete process.env.LUMA_OFFLINE_TEST;}
