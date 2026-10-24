// Manual debugging tunnel. Does not launch, navigate or activate any TV app.
import {openInspectorTunnel} from './inspector-tunnel.mjs';
const tunnel=await openInspectorTunnel();
console.log('Inspector pasivo: '+tunnel.endpoint+' (abre Luma manualmente si necesitas su target)');
process.once('SIGINT',()=>tunnel.close());process.once('SIGTERM',()=>tunnel.close());
await tunnel.closed;
