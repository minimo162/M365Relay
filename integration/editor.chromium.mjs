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
import {createServer} from 'node:net';
import {CdpClient} from '../src/cdp.mjs';
import {M365Backend} from '../src/m365.mjs';
import {browserOperation,domExpression} from '../src/dom.mjs';
import {browserOperation as legacyOperation} from './fixtures/dom-0.2.2.mjs';
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
 if(window.autoLink){
  const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);const nodes=[];let text;
  while(text=walker.nextNode())if(!text.parentElement.closest('a'))nodes.push(text);
  for(const text of nodes){const index=text.data.indexOf('function.name');if(index<0)continue;
   const middle=text.splitText(index);middle.splitText('function.name'.length);
   const a=document.createElement('a');a.href='https://function.name/PRIVATE-NOT-FOR-LOGS';
   a.onclick=()=>{fixture.linkClicks=(fixture.linkClicks||0)+1;return false;};
   middle.replaceWith(a);a.append(middle);
  }
 }
 if(window.readonlyWrap){
  const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);const nodes=[];let text;
  while(text=walker.nextNode())if(!text.parentElement.closest('[data-readonly-wrap]'))nodes.push(text);
  for(const text of nodes){const index=text.data.indexOf('function.name');if(index<0)continue;
   const middle=text.splitText(index);middle.splitText('function.name'.length);
   const span=document.createElement('span');span.contentEditable='false';span.dataset.readonlyWrap='1';
   middle.replaceWith(span);span.append(middle);
  }
 }
 if((window.transientUnsupported||window.persistentUnsupported)&&!fixture.unsupportedAdded++){
  const img=document.createElement('img');img.alt='PRIVATE-NOT-FOR-LOGS';e.append(img);
  if(window.transientUnsupported)setTimeout(()=>img.remove(),150);
 }

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

async function freePort(){
 const server=createServer();
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const port=server.address().port;
 await new Promise(resolve=>server.close(resolve));
 return port;
}
before(async()=>{
 // Use only loopback CDP and an in-memory about:blank fixture; never contact M365.
 profile=await mkdtemp(join(tmpdir(),'relay-chromium-fixture-'));
 const port=await freePort();let stderr='';
 browserProcess=spawn(process.env.CHROMIUM_PATH||'/usr/bin/chromium',[
  '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--no-first-run',
  '--disable-sync','--no-proxy-server',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'
 ],{stdio:['ignore','ignore','pipe']});
 browserProcess.stderr?.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-4000);});
 await once(browserProcess,'spawn');
 for(let i=0;i<200;i++){
  try{
   const response=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)});
   const info=await response.json();
   if(typeof info.webSocketDebuggerUrl==='string'){ws=info.webSocketDebuggerUrl;break;}
  }catch{}
  if(browserProcess.exitCode!==null)break;
  await sleep(50);
 }
 assert(ws,`Chromium debug endpoint must start${stderr?': '+stderr:''}`);control=await CdpClient.connect(ws);
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

// Inspect exact text, not a whitespace-stripped/percentage approximation.
test('native first 3000 characters preserve exact rendered text despite paragraph layout',async()=>{
 const p=await page();try{
  const text=template.trim()+'\n\nBRIDGE_REQUEST_ID: 11111111-1111-4111-8111-111111111111\nBRIDGE_REQUEST_JSON:\n{}';
  const first=text.slice(0,3000);assert.equal(first.length,3000);await put(p,first);
 const current=await p.op('verifyInput',{expected:first});assert.equal(current.matched,true);
 assert.equal(current.observed_chars,3000);assert.equal(current.reader,'contenteditable-dom');
 }finally{await p.close();}
});
test('native paragraphs preserve blank lines, whitespace, Japanese, emoji, tabs, paths, and JSON',async()=>{
 const cases=['a\nb','a\n\nb','\nå…ˆé ­\n','çµ‚ã‚ã‚ŠÜn','a\n\n','  indent here  ','\t A\tB','a\u00a0b','ğŸ˜€ğŸ‘¨â€\nC:\\Work\\memo.txt','{"x":"a  b","y":"\\\\n"}'];
 for(const text of cases){const p=await page();try{await put(p,text);assert.equal((await p.op('snapshot')).input,text);assert((await p.op('verifyInput',{expected:text})).matched);}finally{await p.close();}}
});
test('native root text + div paragraphs are read correctly',async()=>{
 const p=await page();try{await p.evalJS('document.querySelector("[contenteditable]").replaceChildren()');const text='one\n\ntwo\nthree';await put(p,text);assert.equal((await p.op('snapshot')).input,text);}finally{await p.close();}});
test('inline spans, explicit br and empty p placeholders are distinct',async()=>{
 const p=await page();try{
  await p.evalJS('document.querySelector("[contenteditable]").innerHTML="<p><span>one</span><br><span>two</span></p><p><br></p><p>three</p>"');
  assert.equal((await p.op('snapshot')).input,'one\ntwo\n\nthree');
  assert.equal((await p.op('verifyInput',{expected:'one\ntwo\nthree'})).matched,false);
 }finally{await p.close();}
});
test('textarea value path retains leading/trailing newlines',async()=>{
 const p=await page();try{
  await p.evalJS('document.querySelector("[contenteditable]").outerHTML="<textarea id=\"m365-chat-editor-target-element\"></textarea>"');
  const text='\n×‘y§+:*§—‰ÎØ]ØZ]]
^
NØÛÛœİÏX]ØZ]›Ü
	İ™\šYR[œ]	ËÙ^XİY^JNØ\ÜÙ\
Ë›X]ÚY
NØ\ÜÙ\™\]X[
Ëœ™XY\‹	İ˜[YIÊNÂˆYš[˜[^Ø]ØZ]˜ÛÜÙJ
NßBŸJNÂ\İ
	Ù\]X[[[™İ]]][Û‹ÜXÙ\Ë›[šË[[™HÜÜË[™”Ô\™H›İÚ[[HXØÙ\Y	Ë\Ş[˜Ê
OOÂˆÛÛœİX]ØZ]YÙJ
Nİ^Âˆ]ØZ]]
	ÜØY™W—›˜[YH˜[YWLL\™IÊNÂˆ›ÜŠÛÛœİÜ›Û™ÈÙˆÉÜĞY™W—›˜[YH˜[YWLL\™IË	ÜØY™W›˜[YH˜[YWLL\™IË	ÜØY™W—›˜[YH˜[YWLL\™IË	ÜØY™W—›˜[YH˜[YH\™I×J^Âˆ\ÜÙ\™\]X[

]ØZ]›Ü
	İ™\šYR[œ]	ËÙ^XİYÜ›Û™ßJJK›X]ÚY˜[ÙJNÂˆÛÛœİÙ[™X]ØZ]›Ü
	ÜÙ[™	ËÙ^XİYÜ›Û™ßJNØ\ÜÙ\™\]X[
Ù[™˜ÛXÚÙY˜[ÙJNÂˆBˆ\ÜÙ\™\]X[
]ØZ]™]˜[”Ê	Ùš^\™KœÙ[™ÉÊK
NÂˆYš[˜[^Ø]ØZ]˜ÛÜÙJ
NßBŸJNÂ\İ
	Û›Û‹\™Y›Ü›X]Yœ›İÜÙ\ˆÚ[™Ù\ÈÈÜXÙ\ËİXœÈ\™HXYÛ›ÜÙY›İ\˜\ÙY	Ë\Ş[˜Ê
OOÂˆÛÛœİX]ØZ]YÙJ
Nİ^Âˆ]ØZ]™]˜[”Ê	ÙØİ[Y[œ]Y\TÙ[XİÜŠ–ØÛÛ[Y]X›WHŠKœİ[KÚ]TÜXÙOH››Ü›X[‰ÊNÂˆ]ØZ]]
	È[™[][Û—IÊNØÛÛœİÏX]ØZ]›Ü
	İ™\šYR[œ]	ËÙ^XİY‰È[™[][Û—IßJNØ\ÜÙ\™\]X[
Ë›X]ÚY˜[ÙJNØ\ÜÙ\™\]X[
Ë›ØœÙ\™YÚÚ[™	Û˜œÜ	ÊNÂˆYš[˜[^Ø]ØZ]˜ÛÜÙJ
NßBŸJNÂ\İ
	Ù›Ü™ZYÛˆÜšYÚ[ˆ[™›Û‹]^ÛÛ\ÜÙ\ˆ›Ù\È˜Z[ÛÜÙY	Ë\Ş[˜Ê
OOÂˆÛÛœİX]ØZ]YÙJ
Nİ^ÂˆÛÛœİX]ØZ]ÛÛ›ÛœÙ[™
	Ô[[YK™]˜[X]IËÙ^™\ÜÚ[Û™ÛQ^™\ÜÚ[ÛŠË‹‹˜˜\ÙKÜšYÚ[‰è€ttps://wrong.invalid'},'snapshot'),returnByValue:true},p.sessionId);assert(r.exceptionDetails);
  await p.evalJS('document.querySelector("[contenteditable]").innerHTML="<p>safe<img alt=\\"hidden text\\"></p>"');
  const bad=await control.send('Runtime.evaluate',{expression:domExpression({...base,origin},'snapshot'),returnByValue:true},p.sessionId);assert(bad.exceptionDetails);
 }finally{await p.close();}
});

async function backendCase({text='æ™®é€šã®ä¾é »',targetChars,tools=[],setup='',timing={},onBeforeSend}={}){
 const baseBody={model:MODEL,messages:[{role:'ºÇ«r‰íz{m{m¢‰lr‰ìµø«²