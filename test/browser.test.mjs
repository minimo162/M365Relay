import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { CdpClient,assertWsUrl,verifyBrowserArguments } from '../src/cdp.mjs';
import { M365Backend } from '../src/m365.mjs';
import { publicError } from '../src/errors.mjs';
import { browserOperation } from '../src/dom.mjs';
import { MODEL,PROTOCOL,prepareRequest } from '../src/protocol.mjs';
const config=JSON.parse(await readFile(new URL('../config/settings.example.json',import.meta.url),'utf8'));
Object.assign(config,{origin:'https://m365.cloud.microsoft',profileDir:'C:\\Users\\fixture\\M365Bridge\\edge-profile',pollIntervalMs:2,stableMs:3,readyTimeoutMs:100});
function fixture({origin=config.origin,oldReply='',dropInput=false,wrongReply=false,loseSend=false}={}){
  const events=[],state={text:oldReply,closed:[],sent:0},nodes={};
  const document={activeElement:null,defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible'})},
    createRange:()=>({selectNodeContents(){},collapse(){}}),getSelection:()=>({removeAllRanges(){},addRange(){}}),
    querySelectorAll(selector){return nodes[selector]??[];}};
  function element(text='',click=()=>{}){
    let content=String(text);
    const e={nodeType:1,tagName:'DIV',isContentEditable:true,childNodes:[],ownerDocument:document,getBoundingClientRect:()=>({width:100,height:40}),getAttribute:()=>null,querySelectorAll:()=>[],focus(){document.activeElement=this;},click};
    const sync=()=>{e.childNodes=content?[{nodeType:3,nodeValue:content}]:[];};
    Object.defineProperties(e,{
      innerText:{get(){return content;},set(v){content=String(v);sync();},configurable:true},
      textContent:{get(){return content;},set(v){content=String(v);sync();},configurable:true}
    });
    sync();return e;
  }
  const editor=element(),reply=element(oldReply);
  nodes[config.selectors.editor[0]]=[editor];nodes[config.selectors.assistant[0]]=[reply];
  const send=element('送信',()=>{
    state.sent++;events.push('clicked');editor.innerText='';
    reply.innerText=wrongReply?'not JSON':JSON.stringify({protocol:PROTOCOL,request_id:state.requestId,action:'final',content:'fixture final',tool_calls:[],complete:true});
    if(loseSend)throw new Error('reply lost');
  });
  const reset=element('新しいチャット',()=>{events.push('newChat');reply.innerText='';editor.innerText='';});
  nodes[config.selectors.send[0]]=[send];nodes[config.selectors.newChat[0]]=[reset];
  const context=vm.createContext({location:{origin},document});
  const browser={
    async send(method,params={},sessionId,signal){
      signal?.throwIfAborted();events.push(method);
      if(method==='Target.createTarget')return{targetId:'owned-target'};
      if(method==='Target.attachToTarget')return{sessionId:'owned-session'};
      if(method==='Target.closeTarget'){state.closed.push(params.targetId);return{success:true};}
      if(method==='Runtime.evaluate'){
        try{return{result:{value:vm.runInContext(params.expression,context)}};}catch{return{exceptionDetails:{text:'page error'}};}
      }
      if(method==='Input.insertText'){if(!dropInput)editor.innerText+=params.text;return{};}
      throw new Error('unexpected method '+method);
    },close(){events.push('close');}
  };
  return {events,state,editor,reply,nodes,context,browser};
}
async function execute(f,{signal=AbortSignal.timeout(1500),onMetrics,selectModel}={}){
  const request=prepareRequest({model:MODEL,messages:[{role:'user',content:'test'}]},'test template');f.state.requestId=request.requestId;
  const backend=new M365Backend(config,{connect:async()=>f.browser,selectModel,editorStableMs:3,inputSettleMs:100,inputPollMs:2,inputStableMs:3,sendReadyMs:100,sendReadyStableMs:3,onMetrics});
  return backend.complete(request,{signal,onBeforeSend:async()=>f.events.push('journaled-before-send')});
}

test('model failure before selection or final send never sends or journals a request',async()=>{
 for(const finalCheck of [false,true]){
  const f=fixture();
  await assert.rejects(execute(f,{selectModel:async({verifyOnly=false})=>{
   if(verifyOnly===finalCheck)throw new Error('model changed');
  }}));
  assert.equal(f.state.sent,0);
  assert(!f.events.includes('journaled-before-send'));
  if(!finalCheck)assert(!f.events.includes('Input.insertText'));
 }
});
test('CDP endpoint requires exact loopback port and browser path',()=>{
  assert.equal(assertWsUrl('ws://127.0.0.1:9336/devtools/browser/abc-123',9336),'ws://127.0.0.1:9336/devtools/browser/abc-123');
  for(const url of ['ws://evil.example:9336/devtools/browser/a','ws://127.0.0.1:9337/devtools/browser/a','ws://127.0.0.1:9336/devtools/page/a','ws://u:p@127.0.0.1:9336/devtools/browser/a'])assert.throws(()=>assertWsUrl(url,9336),{code:'untrusted_cdp'});
});
test('browser profile ownership is checked, not inferred from port availability',()=>{
  verifyBrowserArguments([`--user-data-dir=${config.profileDir}`,'--remote-debugging-port=9336'],config);
  assert.throws(()=>verifyBrowserArguments(['--user-data-dir=C:\\Other','--remote-debugging-port=9336'],config),{code:'profile_mismatch'});
});
test('DOM operations refuse a different origin',()=>{
  const f=fixture({origin:'https://evil.example'});
  assert.throws(()=>vm.runInContext(`(${browserOperation.toString()})(${JSON.stringify(config.origin)},${JSON.stringify(config.selectors)},'snapshot',{})`,f.context));assert.equal(f.state.sent,0);
});
test('assistant-only snapshot skips trailing empty reply and does not read user prompt',()=>{
  const f=fixture({oldReply:'assistant answer'});f.editor.innerText='USER SECRET';f.nodes[config.selectors.assistant[0]].push({...f.reply,innerText:'',textContent:''});
  const s=vm.runInContext(`(${browserOperation.toString()})(${JSON.stringify(config.origin)},${JSON.stringify(config.selectors)},'snapshot',{})`,f.context);
  assert.equal(s.candidates[0],'assistant answer');assert(!s.candidates.includes('USER SECRET'));
});
test('DOM ambiguity stops rather than selecting an arbitrary editor',()=>{
  const f=fixture();f.nodes[config.selectors.editor[0]].push({...f.editor});
  assert.throws(()=>vm.runInContext(`(${browserOperation.toString()})(${JSON.stringify(config.origin)},${JSON.stringify(config.selectors)},'snapshot',{})`,f.context));
});

test('editor readiness restarts after node replacement even when both editors are empty',()=>{
  const f=fixture();let now=0;
  f.context.Date={now:()=>now};
  const run=(operation,args={requestId:'one',stableMs:1000})=>vm.runInContext(`(${browserOperation.toString()})(${JSON.stringify(config.origin)},${JSON.stringify(config.selectors)},${JSON.stringify(operation)},${JSON.stringify(args)})`,f.context);
  assert.equal(run('editorReady').ready,false);
  now=900;assert.equal(run('editorReady').ready,false);
  f.nodes[config.selectors.editor[0]]=[{...f.editor}];
  now=1000;assert.equal(run('editorReady').ready,false);
  now=1900;assert.equal(run('editorReady').ready,false);
  now=2000;assert.equal(run('editorReady').ready,true);
  f.nodes[config.selectors.editor[0]]=[f.editor];
  assert.equal(run('focus').focused,false);
  assert.equal(run('editorReady',{requestId:'two',stableMs:1000}).ready,false);
  assert.equal(f.events.includes('Input.insertText'),false);
});

test('continuously replaced editor times out without insertion or send',async()=>{
  const f=fixture(),original=f.browser.send;
  f.browser.send=async(method,params,...rest)=>{
    if(method==='Runtime.evaluate'&&params.expression.includes(',"editorReady",'))f.nodes[config.selectors.editor[0]]=[{...f.editor}];
    return original(method,params,...rest);
  };
  await assert.rejects(execute(f),{code:'editor_not_ready'});
  assert.equal(f.events.includes('Input.insertText'),false);
  assert.equal(f.state.sent,0);
  assert.deepEqual(f.state.closed,['owned-target']);
});

test('readiness DOM exceptions preserve their operation without exposing page errors',async()=>{
 for(const operation of ['editorReady','sendReady']){
  const f=fixture(),original=f.browser.send;
  f.browser.send=async(method,params,...rest)=>{
   if(method==='Runtime.evaluate'&&params.expression.includes(`,"${operation}",`))return {exceptionDetails:{text:'PRIVATE PAGE CONTENT'}};
   return original(method,params,...rest);
  };
  await assert.rejects(execute(f),error=>{
   const safe=publicError(error);assert.equal(safe.details.dom_operation,operation);
   assert(!JSON.stringify(safe).includes('PRIVATE'));return true;
  });
  assert.equal(f.state.sent,0);
 }
});

test('Scriptor code lines exclude gutters and reject virtualized gaps or incomplete replies',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const rows=[`BRIDGE_FINAL_V2 ${id}`,'  literal \\_ path\\.local  ','END_BRIDGE_FINAL_V2'];
 const f=fixture({oldReply:'Plain Text\n1\n'+rows.join('\n2\n')});
 let indices=[0,1,2];
 const box={querySelectorAll:()=>rows.map((textContent,i)=>({textContent,getAttribute:()=>String(indices[i])}))};
 f.reply.querySelectorAll=s=>s.startsWith('[data-virtualized')?[box]:[];
 const snapshot=()=>vm.runInContext(`(${browserOperation.toString()})(${JSON.stringify(config.origin)},${JSON.stringify(config.selectors)},'snapshot',{})`,f.context);
 assert.equal(snapshot().candidates[0],rows.join('\n'));
 rows.push('\u00a0');indices.push(3);assert.equal(snapshot().candidates[0],rows.join('\n'));rows.pop();indices.pop();
 indices=[0,2,3];assert.equal(snapshot().candidates.length,0);
 indices=[1,2,3];assert.equal(snapshot().candidates.length,0);
 indices=[0,1,2];rows[2]='END_BRIDGE_TOOL';assert.equal(snapshot().candidates.length,0);
 rows.pop();assert.equal(snapshot().candidates.length,0);
});
test('mock DOM: exact input, one send, validated answer, closes only its owned tab',async()=>{
  const f=fixture();const raw=await execute(f);assert.equal(JSON.parse(raw).content,'fixture final');assert.equal(f.state.sent,1);
  assert(f.events.indexOf('journaled-before-send')<f.events.indexOf('clicked'));assert.deepEqual(f.state.closed,['owned-target']);
});

test('timings describe success and pre-send failure without prompt or response contents',async()=>{
 const success=[],f=fixture();await execute(f,{onMetrics:m=>success.push(m)});
 assert.equal(success.length,1);const m=success[0];assert.equal(m.outcome,'success');assert.equal(m.possibly_sent,true);
 assert(m.total_ms>=0);assert(m.response_snapshots>=2);assert(m.first_reply_observed_ms!==null);
 assert(Object.values(m.phase_ms).every(v=>Number.isSafeInteger(v)&&v>=0));
 assert(!JSON.stringify(m).includes('test template'));assert(!JSON.stringify(m).includes('fixture final'));
 const failure=[];await assert.rejects(execute(fixture({dropInput:true}),{onMetrics:m=>failure.push(m)}),{code:'input_mismatch'});
 assert.equal(failure.length,1);assert.equal(failure[0].outcome,'error');assert.equal(failure[0].possibly_sent,false);assert.equal(failure[0].response_snapshots,0);
});

test('a failing timing sink does not turn a successful send into a retryable failure',async()=>{
 for(const onMetrics of [async()=>{throw new Error('sink unavailable');},()=>new Promise(()=>{})]){
  const f=fixture();const raw=await execute(f,{onMetrics});
  assert.equal(JSON.parse(raw).content,'fixture final');assert.equal(f.state.sent,1);
 }
});

test('a complete response is not returned while generation is still busy',async()=>{
 const f=fixture();const original=f.browser.send;let responseReads=0;
 const stop={...f.reply};
 f.browser.send=async(...args)=>{
  if(f.state.sent&&args[0]==='Runtime.evaluate')f.nodes[config.selectors.stop[0]]=responseReads<3?[stop]:[];
  const out=await original(...args);
  if(f.state.sent&&out.result?.value?.candidates)responseReads++;
  return out;
 };
 const raw=await execute(f);assert.equal(JSON.parse(raw).content,'fixture final');
 assert(responseReads>=4);assert.equal(f.state.sent,1);
});
test('mock DOM: restored old conversation is reset before request',async()=>{
  const f=fixture({oldReply:'old conversation'});await execute(f);assert(f.events.includes('newChat'));assert.equal(f.state.sent,1);
});
test('mock DOM: dropped input does not trigger reinsertion or send',async()=>{
  const f=fixture({dropInput:true});await assert.rejects(execute(f),{code:'input_mismatch'});assert.equal(f.state.sent,0);assert.equal(f.events.filter(x=>x==='Input.insertText').length,1);
});
test('mock DOM: invalid completed reply is not repaired or resent',async()=>{
  const f=fixture({wrongReply:true});await assert.rejects(execute(f),{code:'m365_response_invalid'});assert.equal(f.state.sent,1);assert.deepEqual(f.state.closed,[]);
});
test('mock DOM: lost send acknowledgement never produces a second click',async()=>{
  const f=fixture({loseSend:true});await assert.rejects(execute(f),{code:'m365_dom_changed'});assert.equal(f.state.sent,1);
});
test('mock DOM: sign-in page receives no user input',async()=>{
  const f=fixture({origin:'https://login.microsoftonline.com'});await assert.rejects(execute(f),{code:'sign_in_required'});assert.equal(f.state.sent,0);assert(!f.events.includes('Input.insertText'));
});
test('mock DOM: cancellation closes owned tab without sending',async()=>{
  const f=fixture();const c=new AbortController();const old=f.browser.send;
  f.browser.send=async(...args)=>{const out=await old(...args);if(args[0]==='Target.attachToTarget')c.abort();return out;};
  await assert.rejects(execute(f,{signal:c.signal}));assert.equal(f.state.sent,0);assert.deepEqual(f.state.closed,['owned-target']);
});
test('mock DOM: completed input can wait for send readiness without reinsertion',async()=>{
  const f=fixture();
  const send=f.nodes[config.selectors.send[0]][0];
  let disabled=true;
  send.getAttribute=name=>name==='aria-disabled'&&disabled?'true':null;
  const original=f.browser.send;
  let checks=0;
  f.browser.send=async(...args)=>{
    const out=await original(...args);
    if(args[0]==='Runtime.evaluate' && ++checks>3)disabled=false;
    return out;
  };
  const request=prepareRequest({model:MODEL,messages:[{role:'user',content:'test'}]},'test template');f.state.requestId=request.requestId;
  const backend=new M365Backend(config,{connect:async()=>f.browser,editorStableMs:3,inputSettleMs:100,inputPollMs:2,inputStableMs:3,sendReadyMs:100,sendReadyStableMs:3});
  const raw=await backend.complete(request,{signal:AbortSignal.timeout(1500),onBeforeSend:async()=>f.events.push('journaled-before-send')});
  assert.equal(JSON.parse(raw).content,'fixture final');
  assert.equal(f.events.filter(x=>x==='Input.insertText').length,1);
  assert.equal(f.state.sent,1);
});
class FakeWebSocket extends EventTarget {
  constructor(){super();this.readyState=0;this.sent=[];setImmediate(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}
  send(text){this.sent.push(JSON.parse(text));}
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
  reply(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
}
test('CDP command IDs isolate out-of-order responses',async()=>{
  const c=await CdpClient.connect('ws://fixture',{WebSocketClass:FakeWebSocket});
  const a=c.send('A'),b=c.send('B');c.socket.reply({id:2,result:{value:'B'}});c.socket.reply({id:1,result:{value:'A'}});
  assert.deepEqual(await a,{value:'A'});assert.deepEqual(await b,{value:'B'});c.close();
});
test('CDP timeout is explicit and never resends',async()=>{
  const c=await CdpClient.connect('ws://fixture',{WebSocketClass:FakeWebSocket});await assert.rejects(c.send('click',{},undefined,undefined,5),{code:'cdp_timeout'});assert.equal(c.socket.sent.length,1);c.close();
});
test('CDP errors do not expose raw page text',async()=>{
  const c=await CdpClient.connect('ws://fixture',{WebSocketClass:FakeWebSocket});const p=c.send('A');c.socket.reply({id:1,error:{message:'SECRET PAGE DATA'}});
  await assert.rejects(p,e=>e.code==='cdp_error'&&!e.message.includes('SECRET'));c.close();
});

test('editor replacement at end of attachment still receives the full stability interval',async()=>{
 const f=fixture(),request=prepareRequest({model:MODEL,messages:[{role:'user',content:'test'}]},'test template');
 request.definitionAttachments=[{fileName:'relay-tools-123456789abc.txt',bytes:Buffer.from('test')}];f.state.requestId=request.requestId;
 let attachmentFinished=0,insertedAt=0;
 const originalSend=f.browser.send;f.browser.send=async(method,...args)=>{if(method==='Input.insertText')insertedAt=Date.now();return originalSend(method,...args);};
 const backend=new M365Backend({...config,readyTimeoutMs:500},{connect:async()=>f.browser,editorStableMs:40,inputPollMs:2,inputStableMs:3,sendReadyStableMs:3,
  attachImages:async({onProgress,onBeforeUpload})=>{
   await onBeforeUpload();await onProgress();await new Promise(r=>setTimeout(r,45));await onProgress();
   f.nodes[config.selectors.editor[0]]=[{...f.editor}];await onProgress();
   f.nodes[config.selectors.editor[0]]=[f.editor];attachmentFinished=Date.now();
   return {verify:async()=>{},cleanup:async()=>{}};
  }});
 await backend.complete(request,{signal:AbortSignal.timeout(2000),onBeforeSend:async()=>{}});
 assert(insertedAt-attachmentFinished>=40);assert.equal(f.state.sent,1);
});

test('Scriptor final JSON keeps encoded newlines and rejects trailing fence fragments',()=>{
 const id='11111111-1111-4111-8111-111111111111',rows=[`BRIDGE_FINAL_JSON ${id}`,JSON.stringify('レビュー:\n```vba\nx = 1: Debug.Print x\n```'),'END_BRIDGE_FINAL_JSON'];
 const f=fixture({oldReply:'Plain Text '+rows.join('')});
 const box={querySelectorAll:()=>rows.map((textContent,i)=>({textContent,getAttribute:()=>String(i)}))};
 f.reply.querySelectorAll=s=>s.startsWith('[data-virtualized')?[box]:[];
 const snapshot=()=>vm.runInContext(`(${browserOperation.toString()})(${JSON.stringify(config.origin)},${JSON.stringify(config.selectors)},'snapshot',{})`,f.context);
 assert.equal(snapshot().candidates[0],rows.join('\n'));
 rows.push('``');assert.equal(snapshot().candidates.length,0);
});
