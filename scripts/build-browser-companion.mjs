import{readFileSync,mkdirSync,copyFileSync,readdirSync,writeFileSync}from'node:fs';import{join}from'node:path';import{ROOT,lanAddress,localName,config}from'./desktop-config.mjs';
const source=join(ROOT,'browser','holy-companion'),out=join(ROOT,'artifacts','holy-companion');mkdirSync(out,{recursive:true});for(const file of readdirSync(source))copyFileSync(join(source,file),join(out,file));
const manifest=JSON.parse(readFileSync(join(source,'manifest.json'),'utf8'));
const hosts=[...new Set([...manifest.host_permissions,...[lanAddress(),localName(),...config().peers].filter(Boolean).map(host=>'http://'+host+'/*')])];manifest.host_permissions=hosts;manifest.content_scripts[0].matches=hosts;
writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log('Complemento generado en artifacts/holy-companion. Cárgalo una vez desde el navegador; no se ha instalado automáticamente.');
