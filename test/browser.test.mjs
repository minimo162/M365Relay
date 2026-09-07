import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { CdpClient,assertWsUrl,verifyBrowserArguments } from '../src/cdp.mjs';
import { M365Backend } from '../src/m365.mjs';
import { browserOperation } from '../src/dom.mjs';
import { MODEL,PROTOCOL,prepareRequest } from '../src/protocol.mjs';
const config=JSON.parse(await readFile(new URL('../config/settings.example.json',import.meta.url),'utf8'));
Object.assign(config,{origin:'https://m365.cloud.microsoft',profileDir:'C:\\Users\\fixture\\M365Bridge\\edge-profile',pollIntervalMs:2,stableMs:3,readyTimeoutMs:100});
function fixture({origin=config.origin,oldReply='',dropInput=false,wrongReply=false,loseSend=false}={}){
  const events=[],state={text:oldReply,closed:[],sent:0},nodes={};
  const document={activeElement:null,defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible'})},
    createRange:()=>({selectNodeContents(){},collapse(){}}),getSelection:()=>({removeAllRanges(){},addRange(){}}),
    querySelectorAll(selector){return nodes[selector]??[];}};
  function element(text='',click=()=>{}){return {innerText:text,textContent:text,isContentEditable:true,ownerDocument:document,getBoundingClientRect:()=>({width:100,height:40}),getAttribute:()=>null,querySelectorAll:()=>[],focus(){document.activeElement=this;},click};}
  const editor=element(),reply=element(oldReply);
  nodes[config.selectors.editor[0]]=[editor];nodes[config.selectors.assistant[0]]=[reply];
  const send=element('送信',()=>{
    state.sent++;events.push('clicked');editor.innerText='';
    reply.innerText=wrongReply?'not JSON':JSON.stringify({protocol:PROTOCOL,request_id:state.requestId,action:'final',content:'fixture final',tool_calls:[],complete:true});
    if(loseSend)throw new Error('reply lost');
  });
  const reset=element('新しいチャット',()=>{events.push('newChat');reply.innerText='';reply.textContent='';editor.innerText='';});
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
async function execute(f,{signal=AbortSignal.timeout(1500)}={}){
  const request=prepareRequest({model:MODEL,messages:[{role:'user',content:'test'}]},'test template');f.state.requestId=request.requestId;
  const backend=new M365Backend(config,{connect:async()=>f.browser});
  return backend.complete(request,{signal,onBeforeSend:async()=>f.events.push('journaled-before-send')});
}
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
test('mock DOM: exact input, one send, validated answer, closes only its owned tab',async()=>{
  const f=fixture();const raw=await execute(f);assert.equal(JSON.parse(raw).content,'fixture final');assert.equal(f.state.sent,1);
  assert(f.events.indexOf('journaled-before-send')<f.events.indexOf('clicked'));assert.deepEqual(f.state.closed,['owned-target']);
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
