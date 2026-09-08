import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {prepareRequest,MODEL} from '../src/protocol.mjs';
import {Ledger} from '../src/state.mjs';
const template=await readFile(new URL('../prompts/m365-tool-router.md',import.meta.url),'utf8');
test('transport guidance and context mode cannot change duplicate request identity',()=>{
 const body={model:MODEL,messages:[{role:'user',content:'Create Excel result.xlsx'}]};
 const inline=prepareRequest(body,template),attached=prepareRequest(body,template,{attachConversation:true,attachToolDefinitions:true});
 const ledger=new Ledger('unused-test-directory','test-key');
 assert.equal(ledger.fingerprint(inline.payload),ledger.fingerprint(attached.payload));
 assert.equal(attached.payload.runtime_guidance,undefined);
 const wire=JSON.parse(attached.prompt.split('BRIDGE_REQUEST_JSON:\n')[1].split('\nEND_BRIDGE_REQUEST_JSON')[0]);
 assert.equal(wire.runtime_guidance.version,'1.0.148');assert.equal(wire.tool_execution_budget.maxTerminal,3);
});
test('large history moves losslessly to TXT, retaining roles, call links and literal text',()=>{
 const body={model:MODEL,messages:[{role:'system',content:'Keep original source.'},{role:'user',content:'old request'},
  {role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',function:{name:'read_file',arguments:'{"path":"a.txt"}'}}]},
  {role:'tool',tool_call_id:'c1',content:'  <tag> &gt; "quote" \\n\n'+ 'data '.repeat(40000)+'END-EXACT-738'},
  {role:'user',content:'Use the earlier result without reading the file again.'}]};
 const r=prepareRequest(body,template,{attachToolDefinitions:true,attachConversation:true});
 assert(r.prompt.length<8000);assert.equal(r.definitionAttachments.length,2);
 const context=r.definitionAttachments.find(a=>a.fileName.startsWith('relay-context-'));
 const decoded=JSON.parse(context.bytes.toString('utf8'));
 assert.deepEqual(decoded.messages.map(m=>m.message),r.payload.messages);
 assert.equal(decoded.request_id,r.requestId);
 const wire=JSON.parse(r.prompt.split('BRIDGE_REQUEST_JSON:\n')[1].split('\nEND_BRIDGE_REQUEST_JSON')[0]);
 assert.equal(wire.conversation_attachment.sha256,createHash('sha256').update(context.bytes).digest('hex'));
 assert.equal(wire.active_message_index.find(m=>m.index===3).complete,false);
 assert.equal(wire.active_message_index.find(m=>m.index===4).message.content,body.messages[4].content);
 assert(!r.prompt.includes('END-EXACT-738'));
});
test('oversize context fails before upload without silently losing old history',()=>{
 assert.throws(()=>prepareRequest({model:MODEL,messages:[{role:'user',content:'x'.repeat(4*1024*1024)}]},template,{attachConversation:true}),{code:'context_attachment_too_large'});
});
test('current user request has reserved space even with large startup instructions',()=>{
 const current='Current task: preserve source and verify the result.';
 const r=prepareRequest({model:MODEL,messages:[{role:'system',content:'s'.repeat(24000)},{role:'developer',content:'d'.repeat(24000)},{role:'user',content:current}]},template,{attachConversation:true});
 const wire=JSON.parse(r.prompt.split('BRIDGE_REQUEST_JSON:\n')[1].split('\nEND_BRIDGE_REQUEST_JSON')[0]);
 assert.equal(wire.active_message_index.find(m=>m.index===2).message.content,current);
 assert(r.prompt.length<60000);
});
test('attached history supports more than 512 messages with a finite request cap',()=>{
 const body={model:MODEL,messages:Array.from({length:700},(_,i)=>({role:i%2?'assistant':'user',content:`entry ${i}`}))};
 const r=prepareRequest(body,template,{attachConversation:true});
 assert.equal(JSON.parse(r.definitionAttachments[0].bytes).messages.length,700);
 assert(r.prompt.length<12000);
 assert.throws(()=>prepareRequest(body,template),{code:'messages_required'});
 assert.throws(()=>prepareRequest({...body,messages:Array.from({length:4097},()=>({role:'user',content:'x'}))},template,{attachConversation:true}),{code:'messages_required'});
});
test('changing only old history changes the canonical payload and attachment identity',()=>{
 const a=prepareRequest({model:MODEL,messages:[{role:'user',content:'old-A'},{role:'assistant',content:'reply'},{role:'user',content:'next'}]},template,{attachConversation:true});
 const b=prepareRequest({model:MODEL,messages:[{role:'user',content:'old-B'},{role:'assistant',content:'reply'},{role:'user',content:'next'}]},template,{attachConversation:true});
 assert.notDeepEqual(a.payload.messages,b.payload.messages);
 assert.notEqual(a.definitionAttachments[0].fileName,b.definitionAttachments[0].fileName);
});
test('context TXT retains image references without duplicating image bytes',async()=>{
 const bytes=await readFile(new URL('./fixtures/vision-jpeg.jpg',import.meta.url));
 const r=prepareRequest({model:MODEL,messages:[{role:'user',content:[{type:'text',text:'Inspect image'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+bytes.toString('base64')}}]}]},template,{allowImages:true,attachConversation:true});
 const text=r.definitionAttachments[0].bytes.toString('utf8');
 assert.equal(r.images.length,1);assert(!text.includes('data:image/'));
 assert(text.includes(r.images[0].fileName));
 assert.deepEqual(JSON.parse(text).messages[0].message,r.payload.messages[0]);
});

test('evidence retrieval retains exact provenance for distant matches and stays bounded',async()=>{
 const {selectContextEvidence}=await import('../src/context-attachment.mjs');
 const text='x'.repeat(90000)+' DISTANT_CODE=Q-719\n'+'y'.repeat(50000)+'\nOTHER_CODE=R-523';
 const messages=[{role:'tool',tool_call_id:'c1',content:text},{role:'user',content:'Find DISTANT_CODE and OTHER_CODE'}];
 const evidence=selectContextEvidence(messages,'relay-context-123456789abc.txt');
 assert(evidence.some(e=>e.text.includes('DISTANT_CODE=Q-719')));
 assert(evidence.some(e=>e.text.includes('OTHER_CODE=R-523')));
 assert(evidence.reduce((n,e)=>n+e.text.length,0)<=6000);
 for(const e of evidence){assert.equal(e.role,'tool');assert.equal(e.complete,false);assert.equal(e.text,text.slice(e.start_offset,e.end_offset));assert.equal(e.message_index,0);}
});
