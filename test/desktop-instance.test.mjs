import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {existingDesktopPlan,registerDesktopInstance} from '../src/desktop-instance.mjs';
import {createBridgeServer} from '../src/server.mjs';
import {Ledger} from '../src/state.mjs';
import {MODEL,PROTOCOL} from '../src/protocol.mjs';
import {workspaceStatePath} from '../src/workspace-state.mjs';

async function setup(t,complete){
 const home=await mkdtemp(join(tmpdir(),'relay-instance-'));
 await Promise.all(['bridge.lock','vscode-data','workspace','other'].map(p=>mkdir(join(home,p))));
 await writeFile(join(home,'bridge.lock','owner.json'),JSON.stringify({pid:process.pid,started:new Date().toISOString()}));
 const config={home,token:'c'.repeat(64),requestTimeoutMs:3000,maxQueue:1,maxPromptChars:120000};
 const plan={executable:process.execPath,userDataDir:await realpath(join(home,'vscode-data')),workspace:await realpath(join(home,'workspace')),runtimeExecutable:process.execPath,workspaceStateFile:workspaceStatePath(home)};
 let prove;
 const ledger=new Ledger(home,config.token);await ledger.load();
 const server=createBridgeServer({config,template:'',backend:{complete:complete??(()=>{throw Error('Must not call M365');})},ledger,instanceProof:nonce=>prove?.(nonce)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));config.port=server.address().port;
 t.after(async()=>{await server.stop();await rm(home,{recursive:true,force:true});});
 const register=async(p=plan)=>{prove=await registerDesktopInstance(config,p);};
 return {config,plan,register,home,server};
}
test('reopen verifies a live snapshot without sending credentials or modifying it',async t=>{
 const s=await setup(t);await s.register();const path=join(s.home,'bridge.lock','desktop.json'),before=await readFile(path);
 let headers;
 const got=await existingDesktopPlan(s.config,{fetchImpl:(url,options)=>{headers=options.headers;return fetch(url,options);}});
 assert.deepEqual(got,s.plan);assert.equal(headers,undefined);assert.deepEqual(await readFile(path),before);
 const other=await existingDesktopPlan(s.config,{workspace:join(s.home,'other')});assert.equal(other.workspace,await realpath(join(s.home,'other')));assert.equal(other.userDataDir,s.plan.userDataDir);
 assert.deepEqual(await readFile(path),before);
});
test('missing readiness, dead process, and fake proof cannot reopen',async t=>{
 const s=await setup(t);await assert.rejects(existingDesktopPlan(s.config),{code:'instance_not_ready'});
 await s.register();await assert.rejects(existingDesktopPlan(s.config,{alive(){throw Error('dead');}}),{code:'instance_unverifiable'});
 await assert.rejects(existingDesktopPlan(s.config,{fetchImpl:async()=>new Response(JSON.stringify({proof:'0'.repeat(64)}))}),{code:'instance_unverifiable'});
});

test('reopen uses the authenticated snapshot port after automatic selection',async t=>{
 const s=await setup(t);s.plan.port=s.config.port;await s.register();
 const config={...s.config,port:s.config.port===8731?8732:8731};
 assert.deepEqual(await existingDesktopPlan(config),s.plan);
 const path=join(s.home,'bridge.lock','desktop.json');
 const meta=JSON.parse(await readFile(path));meta.plan.port=80;await writeFile(path,JSON.stringify(meta));
 await assert.rejects(existingDesktopPlan(config,{fetchImpl:()=>{throw Error('must not fetch invalid port');}}),{code:'instance_unverifiable'});
});
test('proof cannot be replayed with a different nonce or local snapshot',async t=>{
 const s=await setup(t);await s.register();let old;
 await existingDesktopPlan(s.config,{fetchImpl:async(url,o)=>{const r=await fetch(url,o);old=await r.clone().text();return r;}});
 await assert.rejects(existingDesktopPlan(s.config,{fetchImpl:async()=>new Response(old)}),{code:'instance_unverifiable'});
 const path=join(s.home,'bridge.lock','desktop.json'),meta=JSON.parse(await readFile(path));meta.plan.workspace=join(s.home,'other');await writeFile(path,JSON.stringify(meta));
 await assert.rejects(existingDesktopPlan(s.config),{code:'instance_unverifiable'});
});
test('owner changes while verifying and signed outside profiles are rejected',async t=>{
 const s=await setup(t);await s.register();
 await assert.rejects(existingDesktopPlan(s.config,{fetchImpl:async(url,o)=>{const r=await fetch(url,o);await writeFile(join(s.home,'bridge.lock','owner.json'),'{}');return r;}}),{code:'instance_owner_changed'});
 const other=await setup(t);await other.register({...other.plan,userDataDir:join(other.home,'other')});
 await assert.rejects(existingDesktopPlan(other.config),{code:'instance_unverifiable'});
});
test('proof route rejects browser origin and is unavailable until ready',async t=>{
 const s=await setup(t),url=`http://127.0.0.1:${s.config.port}/desktop-instance?nonce=${'a'.repeat(64)}`;
 assert.equal((await fetch(url)).status,409);await s.register();
 assert.equal((await fetch(url,{headers:{Origin:'https://example.com'}})).status,403);
 const result=await (await fetch(url)).json();assert.deepEqual(Object.keys(result),['proof']);assert(!JSON.stringify(result).includes(s.home));
});

test('a signed bootstrap plan still must use this profile extension directory',async t=>{
 const s=await setup(t);await mkdir(join(s.home,'vscode-extensions'));
 await s.register({...s.plan,extensionsDir:join(s.home,'other')});
 await assert.rejects(existingDesktopPlan(s.config),{code:'instance_unverifiable'});
});
test('reopening while inference is active neither cancels nor resends it',async t=>{
 let enter,release,calls=0;
 const entered=new Promise(r=>enter=r),waiting=new Promise(r=>release=r);
 const s=await setup(t,async(request,{signal,onBeforeSend})=>{
  calls++;await onBeforeSend();enter();await waiting;assert.equal(signal.aborted,false);
  return JSON.stringify({protocol:PROTOCOL,request_id:request.requestId,action:'final',content:'done',tool_calls:[],complete:true});
 });await s.register();
 const response=fetch(`http://127.0.0.1:${s.config.port}/v1/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${s.config.token}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,messages:[{role:'user',content:'fixture'}]})});
 await entered;
 try{assert.deepEqual(await existingDesktopPlan(s.config),s.plan);assert.equal(calls,1);}finally{release();}
 assert.equal((await response).status,200);assert.equal(calls,1);
});
test('removed workspace and malformed ownership have actionable errors',async t=>{
 const s=await setup(t);await s.register();
 await assert.rejects(existingDesktopPlan(s.config,{workspace:join(s.home,'missing')}),{code:'workspace_not_found'});
 await rm(s.plan.workspace,{recursive:true});await assert.rejects(existingDesktopPlan(s.config),{code:'workspace_not_found'});
 await writeFile(join(s.home,'bridge.lock','owner.json'),'null');await assert.rejects(existingDesktopPlan(s.config),{code:'instance_unverifiable'});
 await writeFile(join(s.home,'bridge.lock','desktop.json'),'null');await assert.rejects(existingDesktopPlan(s.config),{code:'instance_unverifiable'});
});
