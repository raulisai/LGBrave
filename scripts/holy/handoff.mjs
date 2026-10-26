import {cleanItem} from '../../desktop/shared/profile-state.mjs';
import {connectorFor} from './connectors.mjs';

// This descriptor travels only with the current TV page, not over an open LAN API.
// It contains the public source title, never a resolved/signed player address.
export function playbackDescriptor(session, owner, now=Date.now()) {
  const item=cleanItem(session?.item);if(!item)return null;
  const choice=cleanChoice(session?.choice);
  const versionKind=cleanKind(session?.versionKind || session?.versions?.find(version=>version.id===session?.version)?.kind);
  return {v:1,owner,item,...(versionKind?{versionKind}:{}),...(choice?{choice}:{}),...(session?.userPaused?{paused:true}:{}),position:session.position?{t:session.position.t,d:session.position.d}:null,updated:now};
}
const cleanKind=value=>['dub','sub','orig'].includes(value)?value:'';
const cleanChoice=value=>cleanKind(value?.kind)?{kind:value.kind}:null;
export function validDescriptor(value,now=Date.now()) {
  if(!value||value.v!==1||!Number.isFinite(value.updated)||now-value.updated>86400000||value.updated-now>60000)return null;
  const item=cleanItem(value.item),connector=item&&connectorFor(item.source);if(!connector)return null;
  const site=new URL(connector.site).hostname,host=new URL(item.url).hostname;
  const mirrors=item.source==='doramasflix'?['doramasflix.io','doramasflix.in','doramasia.com']:[];
  if(host!==site&&!host.endsWith('.'+site)&&!mirrors.includes(host))return null;
  if(item.show) {const show=new URL(item.show);if(show.origin!==new URL(item.url).origin)return null;}
  const p=value.position;
  const position=p&&Number.isFinite(p.t)&&p.t>=0&&Number.isFinite(p.d)&&p.d>0&&p.t<=p.d+30?{t:p.t,d:p.d}:null;
  const choice=cleanChoice(value.choice);
  const versionKind=cleanKind(value.versionKind);
  return {item,position,...(versionKind?{versionKind}:{}),...(choice?{choice}:{}),...(value.paused===true?{paused:true}:{})};
}
export const readDescriptorSource=`(()=>{try{const text=document.documentElement?.dataset.holyPlayback;if(!text||text.length>16384)return null;return JSON.parse(text)}catch{return null}})()`;
export const writeDescriptorSource=descriptor=>`(()=>{if(!document.documentElement)return;document.documentElement.dataset.holyPlayback=${JSON.stringify(JSON.stringify(descriptor))}})()`;
export const clearDescriptorSource=owner=>`(()=>{try{const node=document.documentElement;if(JSON.parse(node?.dataset.holyPlayback||'{}').owner===${JSON.stringify(owner)})delete node.dataset.holyPlayback}catch{}})()`;
