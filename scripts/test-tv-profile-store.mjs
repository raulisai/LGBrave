import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createTVProfileStore, TV_PROFILE_PATH, TV_PROFILE_MAX_BYTES} from '../desktop/shared/tv-profile-store.mjs';
import {acquireTVLease} from './tv-lease.mjs';

let passed = 0;
const check = async (label, test) => { await test(); passed++; };
const defer = () => { let resolve; const promise = new Promise(r => {resolve=r;}); return {promise,resolve}; };
const tick = () => new Promise(r => setImmediate(r));
const absent = () => Object.assign(Error('missing private server path'), {code:2});
function fixture(options = {}) {
  const files = new Map(), channels = [], calls = [], ssh = new EventEmitter();
  let active = true, commits = 0;
  class Channel extends EventEmitter {
    constructor() { super(); this.handles=new Set(); this.ended=0; this.destroyed=0; }
    reply(method, callback, ...values) {
      calls.push(method);
      if (options.hang === method) return;
      queueMicrotask(() => callback(...values));
    }
    open(path, flags, attrs, callback) {
      if (typeof attrs === 'function') {callback=attrs;attrs=undefined;}
      calls.push({method:'open',path,flags,attrs});
      if (flags === 'r' && !files.has(path)) {this.reply('open',callback,absent());return;}
      if (flags === 'wx' && files.has(path)) {this.reply('open',callback,Object.assign(Error('exists'),{code:4}));return;}
      if (flags === 'wx') files.set(path,Buffer.alloc(0));
      const handle={path};this.handles.add(handle);this.reply('open',callback,null,handle);
    }
    fstat(handle, callback) {
      this.reply('fstat',callback,null,{size:options.declaredSize ?? files.get(handle.path).length});
    }
    read(handle, buffer, offset, length, position, callback) {
      const file=files.get(handle.path),bytes=Math.max(0,Math.min(length,options.chunkSize ?? length,file.length-position));
      file.copy(buffer,offset,position,position+bytes);this.reply('read',callback,null,bytes,buffer);
    }
    write(handle, buffer, offset, length, position, callback) {
      if (options.failWrite) {this.reply('write',callback,Error('secret payload and private server details'));return;}
      const data=Buffer.alloc(position+length);files.get(handle.path).copy(data);buffer.copy(data,position,offset,offset+length);files.set(handle.path,data);
      options.onWrite?.(()=>{active=false;});this.reply('write',callback,null);
    }
    close(handle, callback) {
      this.handles.delete(handle);options.onCloseHandle?.(()=>{active=false;});this.reply('close',callback,null);
    }
    unlink(path, callback) {
      files.delete(path);this.reply('unlink',callback,null);
    }
    end() {this.ended++;this.handles.clear();queueMicrotask(()=>this.emit('close'));}
    destroy() {this.destroyed++;this.end();}
  }
  ssh.sftp=callback=>{
    calls.push('sftp');
    if(options.hang==='sftp'){options.captureOpen?.(callback);return;}
    const channel=new Channel();channels.push(channel);
    queueMicrotask(()=>callback(null,channel));
  };
  const commit=async temp=>{
    if(options.remoteCommit && !await options.remoteCommit(temp))return false;
    commits++;options.onCommit?.();
    if(options.commitWait)await options.commitWait.promise;
    if(options.commitError)throw Error('private commit details');
    if(options.commitFalse)return false;
    if(!active)return false;
    files.set(TV_PROFILE_PATH,files.get(temp));files.delete(temp);return true;
  };
  const guard=()=>{if(!active)throw Error('private lease details');};
  const store=createTVProfileStore({ssh,guard,commit,timeout:options.timeout??300});
  return {files,channels,calls,ssh,store,get commits(){return commits;},lose(){active=false;},Channel};
}
const encoded = snapshot => Buffer.from(JSON.stringify(snapshot));
const assertClosed = instance => {
  assert.equal(instance.ssh.listenerCount('close'),0);
  for(const channel of instance.channels){assert.equal(channel.ended,1);assert.equal(channel.handles.size,0);}
};

await check('Missing snapshot returns null and closes SFTP',async()=>{
  const f=fixture();assert.equal(await f.store.read(),null);assertClosed(f);
});
await check('Chunked reads preserve a v1 snapshot',async()=>{
  const f=fixture({chunkSize:7}),snapshot={v:1,preferences:{search:'Google'},history:[{url:'https://example.test/'}]};
  f.files.set(TV_PROFILE_PATH,encoded(snapshot));assert.deepEqual(await f.store.read(),snapshot);assertClosed(f);
});
await check('Atomic writes use an exclusive UUID tempfile with mode 0600',async()=>{
  const f=fixture(),snapshot={v:1,revision:2};
  assert.equal(await f.store.write(snapshot),true);assert.deepEqual(JSON.parse(f.files.get(TV_PROFILE_PATH)),snapshot);
  const open=f.calls.find(call=>call?.method==='open');
  assert.match(open.path,/^\/tmp\/luma-desktop-profile\.json\.[0-9a-f-]{36}\.tmp$/);
  assert.equal(open.flags,'wx');assert.deepEqual(open.attrs,{mode:0o600});assert.equal(f.commits,1);assert.equal(f.files.size,1);assertClosed(f);
});
await check('A refused commit removes only its tempfile',async()=>{
  const f=fixture({commitFalse:true}),old=encoded({v:1,revision:1});f.files.set(TV_PROFILE_PATH,old);
  assert.equal(await f.store.write({v:1,revision:2}),false);assert.deepEqual(f.files.get(TV_PROFILE_PATH),old);assert.equal(f.files.size,1);assertClosed(f);
});
await check('Write and commit failures clean up and hide server error details',async()=>{
  for(const options of [{failWrite:true},{commitError:true}]){
    const f=fixture(options);await assert.rejects(f.store.write({v:1}),error=>error.code==='TV_PROFILE_IO'&&!/secret|private/.test(error.message));
    assert.equal(f.files.size,0);assertClosed(f);
  }
});
await check('Invalid JSON and versions never expose snapshot content in errors',async()=>{
  for(const source of ['{"secret":"sensitive",broken}',JSON.stringify({v:2,secret:'sensitive'}),'[]','null']){
    const f=fixture();f.files.set(TV_PROFILE_PATH,Buffer.from(source));
    await assert.rejects(f.store.read(),error=>error.code==='TV_PROFILE_FORMAT'&&!/sensitive|secret/.test(error.message));assertClosed(f);
  }
});
await check('Writes validate v1 and the actual serialization',async()=>{
  for(const snapshot of [null,[],{v:2},{v:1,toJSON(){return {v:2};}}]){
    const f=fixture();await assert.rejects(f.store.write(snapshot),error=>error.code==='TV_PROFILE_FORMAT');assert.deepEqual(f.calls,[]);
  }
  const f=fixture(),circular={v:1};circular.self=circular;
  await assert.rejects(f.store.write(circular),error=>error.code==='TV_PROFILE_FORMAT');assert.deepEqual(f.calls,[]);
});
await check('Both declared and actual read sizes are bounded to 1 MiB',async()=>{
  for(const options of [{declaredSize:TV_PROFILE_MAX_BYTES+1},{declaredSize:0}]){
    const f=fixture(options);f.files.set(TV_PROFILE_PATH,Buffer.alloc(TV_PROFILE_MAX_BYTES+1,32));
    await assert.rejects(f.store.read(),error=>error.code==='TV_PROFILE_SIZE');assertClosed(f);
  }
});
await check('The UTF8 byte limit applies before creating a remote tempfile',async()=>{
  const f=fixture();await assert.rejects(f.store.write({v:1,data:'á'.repeat(TV_PROFILE_MAX_BYTES/2)}),error=>error.code==='TV_PROFILE_SIZE');assert.deepEqual(f.calls,[]);
});
await check('Lost leases prevent new channels and commits, including mid-write loss',async()=>{
  const f=fixture();f.lose();await assert.rejects(f.store.read(),error=>error.code==='TV_PROFILE_LEASE');await assert.rejects(f.store.write({v:1}),error=>error.code==='TV_PROFILE_LEASE');assert.deepEqual(f.calls,[]);
  for(const options of [{onWrite:lose=>lose()},{onCloseHandle:lose=>lose()}]){
    const f=fixture(options);await assert.rejects(f.store.write({v:1}),error=>error.code==='TV_PROFILE_LEASE');
    assert.equal(f.commits,0);assert.equal(f.files.size,0);assertClosed(f);
  }
});
await check('A transport failure closes the current channel and all file handles',async()=>{
  const f=fixture({hang:'read'});f.files.set(TV_PROFILE_PATH,encoded({v:1}));
  const reading=f.store.read();await tick();f.ssh.emit('close');
  await assert.rejects(reading,error=>error.code==='TV_PROFILE_CLOSED');assertClosed(f);
});
await check('Timed out channel creation closes channels that arrive late',async()=>{
  let arrive;const f=fixture({hang:'sftp',timeout:15,captureOpen:callback=>{arrive=callback;}});
  await assert.rejects(f.store.read(),error=>error.code==='TV_PROFILE_TIMEOUT');
  const channel=new f.Channel();arrive(null,channel);assert.equal(channel.ended,1);assert.equal(channel.destroyed,1);
  assert.doesNotThrow(()=>channel.emit('error',Error('late error')));assertClosed(f);
});
await check('A timed out file operation force closes the SFTP channel',async()=>{
  const f=fixture({hang:'write',timeout:15});await assert.rejects(f.store.write({v:1}),error=>error.code==='TV_PROFILE_TIMEOUT');assert.equal(f.commits,0);assert.equal(f.channels[0].destroyed,1);assertClosed(f);
});
await check('SFTP channel errors settle once and cannot escape as unhandled events',async()=>{
  const f=fixture({hang:'read'});f.files.set(TV_PROFILE_PATH,encoded({v:1}));
  const reading=f.store.read();await tick();f.channels[0].emit('error',Error('private transport details'));
  await assert.rejects(reading,error=>error.code==='TV_PROFILE_IO'&&!/private/.test(error.message));
  assert.doesNotThrow(()=>f.channels[0].emit('error',Error('late')));assertClosed(f);
});
await check('Constructing a store requires a live authenticated session and lease',async()=>{
  assert.throws(()=>createTVProfileStore(),error=>error.code==='TV_PROFILE_CONFIG');
  assert.throws(()=>createTVProfileStore({ssh:{sftp(){}},guard(){throw Error('expired');},commit(){}}),error=>error.code==='TV_PROFILE_LEASE');
});

await check('Exactly 1 MiB is accepted for reads and writes',async()=>{
  const snapshot={v:1,data:''},padding=TV_PROFILE_MAX_BYTES-encoded(snapshot).length;snapshot.data='x'.repeat(padding);
  const f=fixture();assert.equal(encoded(snapshot).length,TV_PROFILE_MAX_BYTES);
  assert.equal(await f.store.write(snapshot),true);assert.deepEqual(await f.store.read(),snapshot);assertClosed(f);
});
await check('Lease loss during final read cleanup cannot return a stale snapshot',async()=>{
  const f=fixture({onCloseHandle:lose=>lose()});f.files.set(TV_PROFILE_PATH,encoded({v:1}));
  await assert.rejects(f.store.read(),error=>error.code==='TV_PROFILE_LEASE');assertClosed(f);
});
await check('A commit finishing after timeout cannot revive the closed SFTP channel',async()=>{
  const waiting=defer(),f=fixture({commitWait:waiting,timeout:15});
  await assert.rejects(f.store.write({v:1}),error=>error.code==='TV_PROFILE_TIMEOUT');
  assert.equal(f.commits,1);assertClosed(f);f.lose();waiting.resolve();await tick();assertClosed(f);
  assert.equal(f.files.has(TV_PROFILE_PATH),false);
});
await check('The real lease accepts the actual store tempfile and rejects foreign paths',async()=>{
  const commands=[];
  const lease=await acquireTVLease({}, {run:async command=>{
    commands.push(command);
    return command.includes('echo committed')?'committed':command.includes('echo released')?'released':'acquired';
  }});
  try {
    const f=fixture({remoteCommit:path=>lease.commitSnapshot(path)});
    assert.equal(await f.store.write({v:1}),true);
    assert.ok(commands.some(command=>/mv '\/tmp\/luma-desktop-profile\.json\.[0-9a-f-]{36}\.tmp'/.test(command)));
    await assert.rejects(lease.commitSnapshot('/tmp/other'),/inválida/);
    assertClosed(f);
  } finally {await lease.release();}
});
console.log(`${passed} comprobaciones del perfil compartido SFTP correctas (sin TV ni Internet).`);
