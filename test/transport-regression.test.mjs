import test from 'node:test';
import assert from 'node:assert/strict';
import {MODEL,PROTOCOL,prepareRequest,parseEnvelope,completion} from '../src/protocol.mjs';

const tool=name=>({type:'function',function:{name,parameters:{type:'object',properties:{command:{type:'string'},mode:{enum:['sync','async']}},required:['command','mode'],additionalProperties:false}}});
const request=(extra={})=>prepareRequest({model:MODEL,messages:[{role:'user',content:'test'}],tools:[tool('run_in_terminal'),tool('other_tool')],...extra},'test template');
const rawTool=(r,{name='run_in_terminal',command='echo ok',mode='sync',separator='\n',escaped=false}={})=>{
 const marker=s=>escaped?s.replaceAll('_','\\_'):s;
 return [marker('BRIDGE_TOOL')+' '+r.requestId,'NAME '+name,'CONTENT','Test explanation',marker('END_CONTENT'),'ARG /command string',command,marker('END_ARG'),'ARG /mode string',mode,marker('END_ARG'),marker('END_BRIDGE_TOOL')].join(separator);
};
const jsonTool=(r,name='run_in_terminal')=>JSON.stringify({protocol:PROTOCOL,request_id:r.requestId,action:'tool_calls',content:'Test',tool_calls:[{name,arguments:{command:'echo ok',mode:'sync'}}],complete:true});
function history(count,name='run_in_terminal'){
 const messages=[{role:'user',content:'test'}];
 for(let i=0;i<count;i++){
  messages.push({role:'assistant',content:null,tool_calls:[{id:'c'+i,type:'function',function:{name,arguments:'{"command":"echo ok","mode":"sync"}'}}]});
  messages.push({role:'tool',tool_call_id:'c'+i,content:'failed; no readable PDF text'});
 }
 return messages;
}

test('final transport accepts newline, same-line and escaped markers',()=>{
 const r=request({tools:[]});
 for(const sep of ['\n',' '])for(const token of ['BRIDGE_FINAL','BRIDGE\\_FINAL']){
  assert.equal(parseEnvelope(`${token} ${r.requestId}${sep}こんにちは！`,r).content,'こんにちは！');
 }
});
test('final transport retains prose quotes, internal line breaks and literal backslashes',()=>{
 const r=request({tools:[]});
 const content='# Overview\n\n"quoted" C:\\Work\\file_name.pdf\nliteral \\_ text';
 assert.equal(parseEnvelope(`BRIDGE_FINAL ${r.requestId}\n${content}`,r).content,content);
});
test('raw tool preserves shell command and returns native JSON arguments',()=>{
 const r=request();
 const command='$pdf="C:\\Users\\fixture\\file.pdf"; python -c "print(\'x\')"\nWrite-Output "a_b"';
 const out=parseEnvelope(rawTool(r,{command}),r);
 assert.equal(out.tool_calls[0].arguments.command,command);
 const result=completion(out,r);
 assert.equal(result.choices[0].finish_reason,'tool_calls');
 assert.equal(JSON.parse(result.choices[0].message.tool_calls[0].function.arguments).command,command);
});
test('single-line raw tool and escaped control tokens preserve command content',()=>{
 const r=request();const command='python -c "print(\'a_b\')"';
 for(const escaped of [false,true]){
  const out=parseEnvelope(rawTool(r,{command,separator:' ',escaped}),r);
  assert.equal(out.tool_calls[0].arguments.command,command);
  assert.equal(out.tool_calls[0].arguments.mode,'sync');
 }
});
test('raw transports reject a different request ID',()=>{
 const r=request(),other=request();
 assert.throws(()=>parseEnvelope(rawTool(other),r),{code:'invalid_envelope'});
 assert.throws(()=>parseEnvelope(`BRIDGE_FINAL ${other.requestId} answer`,r),{code:'invalid_envelope'});
});
test('raw transports retain none, required and named tool choices',()=>{
 const none=request({tool_choice:'none'});
 assert.throws(()=>parseEnvelope(rawTool(none),none),{code:'tool_choice_violation'});
 for(const choice of ['required',{type:'function',function:{name:'other_tool'}}]){
  const r=request({tool_choice:choice});
  assert.throws(()=>parseEnvelope(`BRIDGE_FINAL ${r.requestId} answer`,r),{code:'tool_choice_violation'});
 }
 const named=request({tool_choice:{type:'function',function:{name:'other_tool'}}});
 assert.throws(()=>parseEnvelope(rawTool(named),named),{code:'tool_choice_violation'});
});
test('raw tool validates enum values and requires complete terminal marker',()=>{
 const r=request();
 assert.throws(()=>parseEnvelope(rawTool(r,{mode:'invalid'}),r),{code:'invalid_tool_arguments'});
 assert.throws(()=>parseEnvelope(rawTool(r).replace(/END_BRIDGE_TOOL$/,''),r),{code:'invalid_envelope'});
});
test('raw tool rejects duplicate and prototype argument paths',()=>{
 const r=request();
 for(const path of ['/command','/__proto__/polluted']){
  const raw=rawTool(r).replace('END_BRIDGE_TOOL',`ARG ${path} string\nx\nEND_ARG\nEND_BRIDGE_TOOL`);
  assert.throws(()=>parseEnvelope(raw,r),{code:'invalid_envelope'});
 }
 assert.equal({}.polluted,undefined);
});
test('final transport still enforces the requested JSON schema',()=>{
 const r=request({tools:[],response_format:{type:'json_schema',json_schema:{schema:{type:'object',properties:{title:{type:'string'}},required:['title'],additionalProperties:false}}}});
 assert.equal(parseEnvelope(`BRIDGE_FINAL ${r.requestId}\n{"title":"ok"}`,r).content,'{"title":"ok"}');
 assert.throws(()=>parseEnvelope(`BRIDGE_FINAL ${r.requestId}\n{"title":1}`,r),{code:'invalid_final_format'});
});
test('fourth terminal call is blocked for raw and legacy JSON transports',()=>{
 const r=request({messages:history(3)});
 assert.equal(r.toolBudget.terminalUsed,3);
 for(const raw of [rawTool(r),jsonTool(r)])assert.throws(()=>parseEnvelope(raw,r),{code:'tool_loop_detected'});
 assert.equal(parseEnvelope(`BRIDGE_FINAL ${r.requestId} No text extracted.`,r).action,'final');
});
test('thirteenth total tool call is blocked for both transports',()=>{
 const r=request({messages:history(12,'other_tool')});
 assert.equal(r.toolBudget.totalUsed,12);
 for(const raw of [rawTool(r,{name:'other_tool'}),jsonTool(r,'other_tool')])assert.throws(()=>parseEnvelope(raw,r),{code:'tool_loop_detected'});
});
test('third terminal call is allowed and an explicit new user turn resets the budget',()=>{
 const r=request({messages:history(2)});assert.equal(parseEnvelope(rawTool(r),r).action,'tool_calls');
 const fresh=request({messages:[...history(3),{role:'user',content:'new request'}]});
 assert.equal(fresh.toolBudget.totalUsed,0);assert.equal(fresh.toolBudget.terminalUsed,0);
 assert.equal(parseEnvelope(rawTool(fresh),fresh).action,'tool_calls');
});

test('fenced json-string arguments preserve exact whitespace, Windows paths and marker text',()=>{
 const r=request();
 const command='  \tC:\\Work\\.local\\a_b.txt\nimport x;\nimport y;\n END_ARG \n"quoted" literal \\n\n  ';
 const body=rawTool(r,{command:JSON.stringify(command)}).replace('ARG /command string','ARG /command json-string');
 for(const raw of [body,'```text\n'+body+'\n```']){
  const value=JSON.parse(completion(parseEnvelope(raw,r),r).choices[0].message.tool_calls[0].function.arguments).command;
  assert.equal(value,command);
 }
});

test('json-string supports empty strings and rejects malformed or non-string values',()=>{
 const r=request();
 const wrap=s=>rawTool(r,{command:s}).replace('ARG /command string','ARG /command json-string');
 assert.equal(parseEnvelope(wrap('""'),r).tool_calls[0].arguments.command,'');
 for(const s of ['null','{}','"bad\\q"','"unterminated','"first" "second"','"literal\nnewline"'])assert.throws(()=>parseEnvelope(wrap(s),r));
});

test('outer fences do not permit surrounding prose or bypass ID and tool choice checks',()=>{
 const r=request(), other=request();
 const wrapped='```text\n'+rawTool(r)+'\n```';
 assert.throws(()=>parseEnvelope('explanation\n'+wrapped,r));
 assert.throws(()=>parseEnvelope(wrapped+'\nafterword',r));
 assert.throws(()=>parseEnvelope(wrapped,other),{code:'invalid_envelope'});
 const none=request({tool_choice:'none'});
 assert.throws(()=>parseEnvelope('```text\n'+rawTool(none)+'\n```',none),{code:'tool_choice_violation'});
 const final=request({tools:[]});
 const content='A\n```js\nx()\n```\nC:\\Work\\.local';
 assert.equal(parseEnvelope('````text\nBRIDGE_FINAL '+final.requestId+'\n'+content+'\n````',final).content,content);
});

test('serialized prompt is bounded at 120000 characters even with legacy larger settings',()=>{
 const body={model:MODEL,messages:[{role:'user',content:''}]};
 const overhead=prepareRequest(body,'test template').prompt.length;
 body.messages[0].content='a'.repeat(120000-overhead);
 assert.equal(prepareRequest(body,'test template',{maxPromptChars:180000}).prompt.length,120000);
 body.messages[0].content+='a';
 assert.throws(()=>prepareRequest(body,'test template',{maxPromptChars:180000}),e=>e.code==='context_too_large'&&e.details.prompt_chars===120001&&e.details.max_prompt_chars===120000);
});

test('final v2 requires an end marker without reinterpreting legacy final text',()=>{
 const r=request({tools:[]});
 assert.equal(parseEnvelope(`BRIDGE_FINAL_V2 ${r.requestId}\nanswer\nEND_BRIDGE_FINAL_V2`,r).content,'answer');
 assert.throws(()=>parseEnvelope(`BRIDGE_FINAL_V2 ${r.requestId}\nanswer`,r),{code:'invalid_envelope'});
 assert.equal(parseEnvelope(`BRIDGE_FINAL ${r.requestId}\nanswer\nEND_BRIDGE_FINAL_V2`,r).content,'answer\nEND_BRIDGE_FINAL_V2');
});
