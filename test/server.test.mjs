import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridgeServer } from '../src/server.mjs';
import { Ledger,SerialQueue } from '../src/state.mjs';
import { MODEL,PROTOCOL } from '../src/protocol.mjs';
import { delay,BridgeError } from '../src/errors.mjs';
const template=await readFile(new URL('../prompts/m365-tool-router.md',import.meta.url),'utf8');
const token='a'.repeat(64);
const base={model:MODEL,messages:[{role:'user',content:'fixture question'}]};
const final=(r,content='テスト回答')=>JSON.stringify({protocol:PROTOCOL,request_id:r.requestId,action:'final',content,tool_calls:[],complete:true});
async function setup(t,complete,overrides={}){
  const home=await mkdtemp(join(tmpdir(),'bridge-server-'));const config={token,home,requestTimeoutMs:3000,maxPromptChars:180000,maxQueue:4,...overrides};
  const ledger=new Ledger(home,token);await ledger.load();let calls=0;const log=[];
  const backend={complete:async(r,o)=>{calls++;return complete?complete(r,o):await o.onBeforeSend().then(()=>final(r));}};
  const server=createBridgeServer({config,template,backend,ledger,log:x=>log.push(x)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await server.stop();await rm(home,{recursive:true,force:true});});
  const post=(body=base,headers={})=>fetch(url+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,...headers},body:JSON.stringify(body)});
  return {server,url,post,ledger,home,log,calls:()=>calls};
}
test('HTTP auth/host/origin guards reject without inference',async t=>{
  const s=await setup(t);
  assert.equal((await s.post(base,{Authorization:'Bearer wrong'})).status,401);
  assert.equal((await s.post(base,{Origin:'https://evil.example'})).status,403);
  const badHost=await new Promise((resolve,reject)=>{const r=http.get(s.url+'/health',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);});
  assert.equal(badHost,403);
  assert.equal(s.calls(),0);
});
test('HTTP models and health do not trigger M365 requests',async t=>{
  const s=await setup(t);const health=await (await fetch(s.url+'/health')).json();assert.equal(health.live_verified,false);
  const models=await (await fetch(s.url+'/v1/models',{headers:{Authorization:`Bearer ${token}`}})).json();assert.equal(models.data[0].id,MODEL);assert.equal(s.calls(),0);
});
test('nonstream native Chat Completions result',async t=>{
  const s=await setup(t);const r=await s.post();assert.equal(r.status,200);const data=await r.json();
  assert.equal(data.object,'chat.completion');assert.equal(data.choices[0].message.content,'テスト回答');assert.equal(data.usage,undefined);
});
test('stream native tool call and terminal event, no partial tool execution',async t=>{
  const s=await setup(t,async(r,o)=>{await o.onBeforeSend();return JSON.stringify({protocol:PROTOCOL,request_id:r.requestId,action:'tool_calls',content:'読む',tool_calls:[{name:'native_tool',arguments:{path:'test.txt'}}],complete:true});});
  const b={...base,stream:true,tools:[{type:'function',function:{name:'native_tool',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}}]};
  const r=await s.post(b);const raw=await r.text();assert.match(r.headers.get('content-type'),/text\/event-stream/);assert.match(raw,/"finish_reason":"tool_calls"/);assert.match(raw,/data: \[DONE\]/);
  const frames=raw.split('\n').filter(x=>x.startsWith('data: {')).map(x=>JSON.parse(x.slice(6)));const tc=frames.flatMap(x=>x.choices[0].delta.tool_calls??[])[0];assert.deepEqual(JSON.parse(tc.function.arguments),{path:'test.txt'});
});
test('malformed reply on SSE returns an error and no tool call delta',async t=>{
  const s=await setup(t,async(r,o)=>{await o.onBeforeSend();return '{"action":"tool_calls"';});
  const raw=await (await s.post({...base,stream:true})).text();assert.match(raw,/"error"/);assert.doesNotMatch(raw,/"delta"/);assert.doesNotMatch(raw,/"finish_reason"/);
});
test('duplicate body is blocked, never automatically resent or replayed',async t=>{
  const s=await setup(t);assert.equal((await s.post()).status,200);
  const second=await s.post();assert.equal(second.status,409);assert.equal((await second.json()).error.code,'duplicate_request');assert.equal(s.calls(),1);
  const persisted=await readFile(join(s.home,'requests.json'),'utf8');assert.doesNotMatch(persisted,/fixture question|テスト回答/);
});
test('unknown post-send state survives ledger reload',async t=>{
  const s=await setup(t,async(r,o)=>{await o.onBeforeSend();throw new BridgeError('lost_reply','Result unknown',502);});
  assert.equal((await s.post()).status,502);
  const fresh=new Ledger(s.home,token);await fresh.load();assert(Object.values(fresh.records).some(x=>x.status==='unknown_or_invalid'));
  assert.equal((await s.post()).status,409);assert.equal(s.calls(),1);
});

test('unknown image upload blocks the same image while different image bytes stay distinct',async t=>{
  const jpeg=await readFile(new URL('./fixtures/vision-jpeg.jpg',import.meta.url));
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq1sAAAAASUVORK5CYII=','base64');
  const request=(mime,bytes)=>({...base,messages:[{role:'user',content:[{type:'text',text:'PRIVATE_IMAGE_CAPTION'},{type:'image_url',image_url:{url:`data:${mime};base64,${bytes.toString('base64')}`}}]}]});
  const s=await setup(t,async(r,o)=>{
    assert.equal(r.images.length,1);assert(!r.prompt.includes('base64,'));
    await o.onBeforeSend();throw new BridgeError('image_upload_unknown','Upload acknowledgement lost',502);
  },{allowImages:true});
  assert.equal((await s.post(request('image/jpeg',jpeg))).status,502);
  assert.equal((await s.post(request('image/jpeg',jpeg))).status,409);
  assert.equal(s.calls(),1);
  assert.equal((await s.post(request('image/png',png))).status,502);
  assert.equal(s.calls(),2);
  const fresh=new Ledger(s.home,token);await fresh.load();
  assert.equal(Object.keys(fresh.records).length,2);
  assert(Object.values(fresh.records).every(r=>r.status==='unknown_or_invalid'));
  const stored=await readFile(join(s.home,'requests.json'),'utf8');
  for(const output of [stored,JSON.stringify(s.log)]){
    assert(!output.includes('PRIVATE_IMAGE_CAPTION'));
    assert(!output.includes(jpeg.toString('base64').slice(0,80)));
    assert(!output.includes(png.toString('base64')));
  }
});
test('known pre-send failure permits an explicit later request',async t=>{
  let n=0;const s=await setup(t,async(r,o)=>{if(n++===0)throw new BridgeError('sign_in_required','Sign in',503);await o.onBeforeSend();return final(r);});
  assert.equal((await s.post()).status,503);assert.equal((await s.post()).status,200);assert.equal(s.calls(),2);
});
test('oversized and unsupported requests fail before M365',async t=>{
  const s=await setup(t,undefined,{maxPromptChars:100});assert.equal((await s.post()).status,413);assert.equal(s.calls(),0);
});
test('cancellation reaches backend and prevents successful final response',async t=>{
  let cancelled=false,started;const ready=new Promise(r=>started=r);
  const s=await setup(t,async(r,o)=>{await o.onBeforeSend();started();try{await delay(5000,o.signal);}catch{cancelled=true;throw o.signal.reason;}return final(r);});
  const controller=new AbortController();const responsePromise=fetch(s.url+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({...base,stream:true}),signal:controller.signal});
  const response=await responsePromise;await ready;controller.abort();await response.text().catch(()=>{});
  for(let i=0;i<30&&!cancelled;i++)await delay(10);assert.equal(cancelled,true);
});
test('requests are serialized and preserve request-specific results',async t=>{
  let active=0,max=0;const s=await setup(t,async(r,o)=>{active++;max=Math.max(max,active);try{await o.onBeforeSend();await delay(15,o.signal);return final(r,r.payload.messages[0].content);}finally{active--;}});
  const responses=await Promise.all(['A','B','C'].map(content=>s.post({...base,messages:[{role:'user',content}]})));
  assert.deepEqual(await Promise.all(responses.map(async r=>(await r.json()).choices[0].message.content)),['A','B','C']);assert.equal(max,1);
});
test('logs contain request metadata only, never prompt/result/arguments',async t=>{
  const s=await setup(t);await (await s.post()).text();const logs=JSON.stringify(s.log);assert.doesNotMatch(logs,/fixture question|テスト回答|Authorization|Bearer/);assert.match(logs,/response_returned/);
});
test('queue cancellation removes only the cancelled waiter',async()=>{
  const q=new SerialQueue(2);const first=await q.acquire();const a=new AbortController();const second=q.acquire(a.signal);const third=q.acquire();a.abort();await assert.rejects(second);first();const release=await third;release();assert.equal(q.active,false);
});
test('queue capacity errors are explicit',async()=>{
  const q=new SerialQueue(0);const release=await q.acquire();await assert.rejects(q.acquire(),{code:'bridge_busy'});release();
});
