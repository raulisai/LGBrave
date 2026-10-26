import {PeerSync,privateHost} from '../desktop/shared/peer-sync.mjs';
import {Library} from './holy/library.mjs';import {connectSession} from './inspector-tunnel.mjs';import {config,saveConfig,lanAddress} from './desktop-config.mjs';import {status} from './desktop-control.mjs';
const action=process.argv[2]||'status';
if(action==='setup'){
 const at=process.argv.indexOf('--peer');if(at>=0){const host=process.argv[at+1];if(!privateHost(host))throw Error('Usa la IPv4 privada actual del otro equipo.');const cfg=config();saveConfig({...cfg,peers:[...new Set([...cfg.peers,host])].slice(0,8)});}
 const p=new PeerSync({library:new Library(),host:lanAddress,peers:()=>config().peers,device:()=>config().device,connect:connectSession});await p.discover();console.log(JSON.stringify(p.status()));await p.stop();
}else if(action==='status'){const live=await status();console.log(JSON.stringify(live.peerSync||{state:'not-running',message:'Actualiza e inicia el servicio común para sincronizar.'}));}
else throw Error('Uso: node scripts/profile-sync.mjs setup [--peer IP] | status');
