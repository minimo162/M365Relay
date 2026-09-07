// Standalone regression tests: actual Chromium/CDP, synthetic in-memory about:blank composer.
// No M365 endpoint, tenant, VS Code session, account, or business data is used.
// Run: CHROMIUM_PATH=/usr/bin/chromium node --test integration/editor.chromium.mjs
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {CdpClient} from '../src/cdp.mjs';
import {M365Backend} from '../src/m365.mjs';
import {browserOperation,domExpression} from '../src/dom.mjs';
import {prepareRequest,MODEL} from '../src/protocol.mjs';
import {publicError} from '../src/errors.mjs';

let browserProcess,profile,ws,control;
const origin='null';
const template=await readFile(new URL('../prompts/m365-tool-router.md',import.meta.url),'utf8');
const base=JSON.parse(await readFile(new URL('../config/settings.example.json',import.meta.url),'utf8'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const html=`<!doctype html><meta charset="utf-8"><style>#m365-chat-editor-target-element{white-space:pre-wrap;width:600px;min-height:60px}p{margin:0}</style>
<div id="m365-chat-editor-target-element" role="textbox" contenteditable="true"><p><br></p></div>
<button aria-label="Send">Send</button><button aria-label="New chat">New chat</button>
<div data-message-author-role="assistant"></div>
<script>
window.fixture={inserts:[],sends:0,restores:0};
const e=document.getElementById('m365-chat-editor-target-element'),reply=document.querySelector('[data-message-author-role]');
e.addEventListener('beforeinput',ev=>{if(ev.inputType==='insertText'){fixture.inserts.push(ev.data);if(window.dropInput)ev.preventDefault();}});
e.addEventListener('input',()=>{
 if(window.mutateInput)e.firstChild.textContent=e.firstChild.textContent.replace('SECRET','CHANGED');
 if(window.delayRender&&!fixture.restores++){const nodes=[...e.childNodes].map(n=>n.cloneNode(true));e.replaceChildren();const p=document.createElement('p');p.append(document.createElement('br'));e.append(p);setTimeout(()=>e.replaceChildren(...nodes),150);}
 if(window.transientMatch&&!fixture.restores++)setTimeout(()=>{e.replaceChildren();},80);
});
document.querySelector('[aria-label="Send"]').onclick=()=>{
 fixture.sends++;
 fixture.rendered=e.innerText;
 fixture.domOnSend=e.innerHTML;
 fixture.blockText=[...e.children].map(p=>p.innerText==='\\n'?'':p.innerText).join('\\n');
 const id=/BRIDGE_REQUEST_ID: ([a-f0-9-]{36})/.exec(e.textContent)?.[1];
 reply.textContent=JSON.stringify({protocol:'m365-relay.v1',request_id:id,action:'final',content:'SYNTHETIC TEST ONLY',tool_calls:[],complete:true});
 e.replaceChildren();
};
document.querySelector('[aria-label="New chat"]').onclick=()=>{e.replaceChildren();reply.textContent='';};
</script>`;

before(async()=>{
 // The execution environment blocks HTTP page navigation. Use an in-memory
 // fixture instead; do not change browser/network policies or contact M365.
 profile=await mkdtemp(join(tmpdir(),'relay-chromium-fixture-'));
 browserProcess=spawn(process.env.CHROMIUM_PATH||'/usr/bin/chromium',[
  '--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--no-first-run',
  '--disable-sync','--no-proxy-server','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'
 ],{stdio:'ignore'});
 await once(browserProcess,'spawn');
 for(let i=0;i<400;i++){
  try{const [port,path]=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');ws=`ws://127.0.0.1:${port}${path}`;break;}catch{await sleep(50);}
 }
 assert(ws,'Chromium debug endpoint must start');control=await CdpClient.connect(ws);
 console.log('Browser:',(await control.send('Browser.getVersion')).product);
});
after(async()=>{
 try{await control?.send('Browser.close');}catch{}control?.close();
 if(browserProcess&&browserProcess.exitCode===null){browserProcess.kill();await Promise.race([once(browserProcess,'exit'),sleep(3000)]);}
 if(profile)await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:200});
});
async function page(){
 const {targetId}=await control.send('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await control.send('Target.attachToTarget',{targetId,flatten:true});
 const {frameTree}=await control.send('Page.getFrameTree',{},sessionId);
 await control.send('Page.setDocumentContent',{frameId:frameTree.frame.id,html},sessionId);
 const evalJS=async expression=>{
  const r=await control.send('Runtime.evaluate',{expression,returnByValue:true,userGesture:true},sessionId);
  assert(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;
 };
 for(let i=0;i<100;i++){if(await evalJS('!!document.getElementById("m365-chat-editor-target-element")'))break;await sleep(10);}
 const op=(operation,args={})=>evalJS(domExpression({...base,origin},operation,args));
 return {targetId,sessionId,evalJS,op,close:()=>control.send('Target.closeTarget',{targetId})};
}
async function put(p,text){await p.op('focus');await control.send('Input.insertText',{text},p.sessionId);}

test('actual browser: indexed M365 code DOM preserves data and rejects gaps',async()=>{
 const p=await page();try{
  const rows=['BRIDGE_FINAL_V2 11111111-1111-4111-8111-111111111111','  C:\\Work\\.local\\a_b.txt\t日本語😀  ','END_BRIDGE_FINAL_V2'];
  await p.evalJS(`(()=>{const reply=document.querySelector('[data-message-author-role]');const root=document.createElement('div');root.setAttribute('data-virtualized-code-find-root','true');const box=document.createElement('div');box.setAttribute('role','textbox');box.setAttribute('aria-readonly','true');${JSON.stringify(rows)}.forEach((text,i)=>{const gutter=document.createElement('div');gutter.textContent=String(i+1);const line=document.createElement('div');line.setAttribute('data-line-index',String(i));line.textContent=text;box.append(gutter,line);});root.append(box);reply.append(root);})()`);
  assert.equal((await p.op('snapshot')).candidates[0],rows.join('\n'));
  await p.evalJS(`document.querySelector('[data-line-index="1"]').remove()`);
  assert.equal((await p.op('snapshot')).candidates.length,0);
 }finally{await p.close();}
});

// Inspect exact text, not a whitespace-stripped/percentage approximation.
test('first 3000 characters preserve paragraph text independently of current prompt length',async()=>{
 const p=await page();try{
  const text=template.trim()+'\n\nBRIDGE_REQUEST_ID: 11111111-1111-4111-8111-111111111111\nBRIDGE_REQUEST_JSON:\n{}\n';
  const first=text.slice(0,3000);assert.equal(first.length,3000);await put(p,first);
  const old=await p.evalJS('document.querySelector("[contenteditable]").innerText');
  assert.notEqual(old.replace(/\r\n?/g,'\n').replace(/\n$/,''),first);
  const current=await p.op('verifyInput',{expected:first});assert.equal(current.matched,true);
  assert.equal(current.observed_chars,3000);assert.equal(current.reader,'contenteditable-dom');
  console.log(`First chunk: expected=3000, rendered=${old.length}, new reader=${current.observed_chars}`);
 }finally{await p.close();}
});
test('native paragraphs preserve blank lines, whitespace, Japanese, emoji, tabs, paths, and JSON',async()=>{
 const cases=['a\nb','a\n\nb','\n先頭\n','終わり\n','a\n\n','  indent  here  ','\t A\tB','a\u00a0b','😀👩‍💻\nC:\\Work\\memo.txt','{"x":"a  b","y":"\\\\n"}'];
 for(const text of cases){const p=await page();try{await put(p,text);assert.equal((await p.op('snapshot')).input,text);assert((await p.op('verifyInput',{expected:text})).matched);}finally{await p.close();}}
});
test('native root text + div paragraphs are read correctly',async()=>{
 const p=await page();try{await p.evalJS('document.querySelector("[contenteditable]").replaceChildren()');const text='one\n\ntwo\nthree';await put(p,text);assert.equal((await p.op('snapshot')).input,text);}finally{await p.close();}
});
test('inline spans, explicit br and empty p placeholders are distinct',async()=>{
 const p=await page();try{
  await p.evalJS('document.querySelector("[contenteditable]").innerHTML="<p><span>one</span><br><span>two</span></p><p><br></p><p>three</p>"');
  assert.equal((await p.op('snapshot')).input,'one\ntwo\n\nthree');
  assert.equal((await p.op('verifyInput',{expected:'one\ntwo\nthree'})).matched,false);
 }finally{await p.close();}
});
test('textarea value path retains leading/trailing newlines',async()=>{
 const p=await page();try{
  await p.evalJS('document.querySelector("[contenteditable]").outerHTML="<textarea id=\\"m365-chat-editor-target-element\\"></textarea>"');
  const text='\n\n日本語\n';await put(p,text);const c=await p.op('verifyInput',{expected:text});assert(c.matched);assert.equal(c.reader,'value');
 }finally{await p.close();}
});
test('equal-length mutation, spaces, blank-line loss, and NBSP are not silently accepted',async()=>{
 const p=await page();try{
  await put(p,'safe\n\nname  value\u00a0here');
  for(const wrong of ['sAfe\n\nname  value\u00a0here','safe\nname  value\u00a0here','safe\n\nname value\u00a0here','safe\n\nname  value here']){
   assert.equal((await p.op('verifyInput',{expected:wrong})).matched,false);
   const send=await p.op('send',{expected:wrong});assert.equal(send.clicked,false);
  }
  assert.equal(await p.evalJS('fixture.sends'),0);
 }finally{await p.close();}
});
test('non-preformatted browser changes to spaces/tabs are diagnosed, not erased',async()=>{
 const p=await page();try{
  await p.evalJS('document.querySelector("[contenteditable]").style.whiteSpace="normal"');
  await put(p,'  indentation\t A');const c=await p.op('verifyInput',{expected:'  indentation\t A'});assert.equal(c.matched,false);assert.equal(c.observed_kind,'nbsp');
 }finally{await p.close();}
});
test('foreign origin and non-text composer nodes fail closed',async()=>{
 const p=await page();try{
  const r=await control.send('Runtime.evaluate',{expression:domExpression({...base,origin:'https://wrong.invalid'},'snapshot'),returnByValue:true},p.sessionId);assert.equal(r.result.value.__m365_relay_dom_error__.reason,'origin_mismatch');
  await p.evalJS('document.querySelector("[contenteditable]").innerHTML="<p>safe<img alt=\\"hidden text\\"></p>"');
  const bad=await control.send('Runtime.evaluate',{expression:domExpression({...base,origin},'snapshot'),returnByValue:true},p.sessionId);assert.equal(bad.result.value.__m365_relay_dom_error__.reason,'unsupported_editor_node');assert.equal(bad.result.value.__m365_relay_dom_error__.tag,'IMG');
 }finally{await p.close();}
});

async function backendCase({text='普通の依頼',setup='',timing={},onBeforeSend}={}){
 const request=prepareRequest({model:MODEL,messages:[{role:'user',content:text}]},template);
 const evidence={methods:[],journaled:0};let client;
 const config={...base,origin,copilotUrl:'about:blank',pollIntervalMs:25,stableMs:50,readyTimeoutMs:5000};
 const backend=new M365Backend(config,{...timing,connect:async()=>{
  client=await CdpClient.connect(ws);const send=client.send.bind(client);
  return {
   async send(method,params={},sid,signal,timeout){
    evidence.methods.push(method);
    if(method==='Input.insertText'&&!evidence.setup){evidence.setup=true;if(setup)await send('Runtime.evaluate',{expression:setup},sid);}
    if(method==='Target.closeTarget'&&evidence.sid){const r=await send('Runtime.evaluate',{expression:'JSON.stringify(fixture)',returnByValue:true},evidence.sid);evidence.fixture=JSON.parse(r.result.value);}
    const out=await send(method,params,sid,signal,timeout);
    if(method==='Target.createTarget')evidence.target=out.targetId;
    if(method==='Target.attachToTarget'){
      evidence.sid=out.sessionId;
      const {frameTree}=await send('Page.getFrameTree',{},out.sessionId);
      await send('Page.setDocumentContent',{frameId:frameTree.frame.id,html},out.sessionId);
    }
    return out;
   },close:()=>client.close()
  };
 }});
 try{evidence.raw=await backend.complete(request,{signal:AbortSignal.timeout(20000),onBeforeSend:async()=>{evidence.journaled++;await onBeforeSend?.(client,evidence);}});}
 catch(error){evidence.error=error;}
 if(!evidence.fixture&&evidence.target){
  try{const {sessionId}=await control.send('Target.attachToTarget',{targetId:evidence.target,flatten:true});const r=await control.send('Runtime.evaluate',{expression:'JSON.stringify(fixture)',returnByValue:true},sessionId);evidence.fixture=JSON.parse(r.result.value);}finally{await control.send('Target.closeTarget',{targetId:evidence.target});}
 }
 evidence.request=request;return evidence;
}
test('real CDP backend inputs >40000 UTF-16 units in one insertion and clicks once',async()=>{
 const a=await backendCase({text:'😀 日本語 空白  ; C:\\Work\\memo.txt\n'.repeat(1500)});
 assert.ifError(a.error);assert(a.request.prompt.length>40000);assert.equal(a.fixture.inserts.join(''),a.request.prompt);assert.equal(a.fixture.inserts.length,1);
 assert.equal(a.fixture.blockText,a.request.prompt);assert.equal(a.fixture.sends,1);assert.equal(a.journaled,1);
 assert(a.fixture.inserts.every(s=>!/[\uD800-\uDBFF]$/.test(s)));assert.equal(JSON.parse(a.raw).content,'SYNTHETIC TEST ONLY');
 console.log(`Native complete: ${a.request.prompt.length} UTF-16 units, ${a.fixture.inserts.length} chunks, sends=1`);
});
test('delayed 150ms DOM reconciliation completes without any repeated insertion',async()=>{
 const a=await backendCase({setup:'window.delayRender=true'});assert.ifError(a.error);assert.equal(a.fixture.inserts.join(''),a.request.prompt);assert.equal(a.fixture.sends,1);
});
test('a transient exact match followed by DOM rollback cannot trigger send',async()=>{
 const a=await backendCase({setup:'window.transientMatch=true',timing:{inputSettleMs:600,inputPollMs:25,inputStableMs:200}});
 assert.equal(a.error?.code,'input_mismatch');assert.equal(a.fixture.inserts.length,1);assert.equal(a.fixture.sends,0);assert.equal(a.journaled,0);
});
test('actual input drop stops, exposes only safe metadata, never reinserts or clicks',async()=>{
 const a=await backendCase({text:'SECRET-DO-NOT-EXPOSE',setup:'window.dropInput=true',timing:{inputSettleMs:200,inputPollMs:25,inputStableMs:50}});
 assert.equal(a.error?.code,'input_mismatch');assert.equal(a.fixture.inserts.length,1);assert.equal(a.fixture.sends,0);assert.equal(a.journaled,0);
 const out=publicError(a.error);assert.equal(out.details.expected_chars,a.request.prompt.length);assert.equal(out.details.observed_chars,0);assert.equal(out.details.first_difference,0);
 assert(!JSON.stringify(out).includes('SECRET'));assert(!JSON.stringify(out).includes('BRIDGE_REQUEST'));
});
test('final atomic send check rejects edits made after the journal callback',async()=>{
 const a=await backendCase({onBeforeSend:async(c,e)=>c.send('Runtime.evaluate',{expression:'document.querySelector("[contenteditable]").firstChild.textContent="CHANGED"'},e.sid)});
 assert.equal(a.error?.code,'input_changed');assert.equal(a.fixture.sends,0);assert.equal(a.journaled,1);
});


test('real DOM text wrappers and hidden decorations preserve exact input',async()=>{
 const p=await page();try{
  for(const markup of [
   '<p><a href="https://example.invalid/PRIVATE">text</a></p>',
   '<p><span contenteditable="false">te<b>xt</b></span></p>',
   '<p><span aria-hidden="true">PRIVATE</span>text</p>'
  ]){
   await p.evalJS(`document.querySelector('[contenteditable]').innerHTML=${JSON.stringify(markup)}`);
   assert.equal((await p.op('verifyInput',{expected:'text'})).matched,true);
   assert.equal((await p.op('send',{expected:'Text'})).clicked,false);
  }
  assert.equal(await p.evalJS('fixture.sends'),0);
 }finally{await p.close();}
});
test('real CDP waits for delayed send enablement without reinserting',async()=>{
 const a=await backendCase({
  setup:`document.querySelector('[contenteditable]').addEventListener('input',()=>{
   const button=document.querySelector('[aria-label="Send"]');button.disabled=true;
   setTimeout(()=>{button.disabled=false;fixture.sendEnabled=true;},400);
  },{once:true})`,
  timing:{inputStableMs:50,inputPollMs:25,sendReadyMs:2000,sendReadyStableMs:50},
  onBeforeSend:async(c,e)=>{
   const r=await c.send('Runtime.evaluate',{expression:'fixture.sendEnabled===true',returnByValue:true},e.sid);
   assert.equal(r.result.value,true);
  }
 });
 assert.ifError(a.error);assert.equal(a.fixture.inserts.length,1);
 assert.equal(a.fixture.inserts[0],a.request.prompt);assert.equal(a.fixture.sends,1);assert.equal(a.journaled,1);
});
test('real CDP times out a disabled send control without journal or click',async()=>{
 const a=await backendCase({
  setup:`document.querySelector('[aria-label="Send"]').disabled=true`,
  timing:{inputStableMs:50,inputPollMs:25,sendReadyMs:200,sendReadyStableMs:50}
 });
 assert.equal(a.error?.code,'send_not_ready');assert.equal(a.fixture.inserts.length,1);
 assert.equal(a.fixture.sends,0);assert.equal(a.journaled,0);
});
