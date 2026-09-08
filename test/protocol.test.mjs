import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { strictJson, canonical } from '../src/json.mjs';
import { compileSchema } from '../src/schema.mjs';
import { prepareRequest,parseEnvelope,completion,streamChunks,PROTOCOL,MODEL } from '../src/protocol.mjs';
const template=await readFile(new URL('../prompts/m365-tool-router.md',import.meta.url),'utf8');
const tool={type:'function',function:{name:'read_file',description:'テスト用に与えるスキーマ。実VS Codeの名前・引数を固定する設定ではない。',parameters:{type:'object',properties:{filePath:{type:'string',minLength:1},startLine:{type:'integer',minimum:1}},required:['filePath'],additionalProperties:false}}};
const body=(extra={})=>({model:MODEL,messages:[{role:'system',content:'Use the offered tools.'},{role:'user',content:'read the document'}],tools:[tool],...extra});
const request=(extra={})=>prepareRequest(body(extra),template);
const envelope=(r,extra={})=>({protocol:PROTOCOL,request_id:r.requestId,action:'tool_calls',content:'内容を確認します。',tool_calls:[{name:'read_file',arguments:{filePath:'C:\\作業\\a.txt',startLine:1}}],complete:true,...extra});
test('strict JSON: duplicate normal and escaped keys are rejected',()=>{
  for(const s of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"x":{"a":1,"a":2}}'])assert.throws(()=>strictJson(s),{code:'invalid_json'});
});
test('strict JSON: malformed/truncated/nonfinite input is not repaired',()=>{
  for(const s of ['{"a":1,}','{"a":','[1,]','{"n":1e999}','{"a":1} prose','```json\n{}\n```'])assert.throws(()=>strictJson(s));
});
test('strict JSON: quotes, braces, Unicode and prototype names preserve values',()=>{
  const s='{"__proto__":{"polluted":true},"x":"日本語 \\" {}","arr":[true,false,null,-1.2e2]}';
  assert.deepEqual(strictJson(s),JSON.parse(s));assert.equal({}.polluted,undefined);
});
test('strict JSON: bounded depth and bytes',()=>{
  assert.throws(()=>strictJson('[[[0]]]',{maxDepth:2}));assert.throws(()=>strictJson('"日本語"',{maxBytes:5}),{code:'json_size'});
});
test('schema: required/type/extra fields/enum/minimum enforced without coercion',()=>{
  const v=compileSchema({type:'object',properties:{n:{type:'integer',minimum:1},kind:{enum:['a','b']}},required:['n'],additionalProperties:false});
  assert.equal(v({n:1,kind:'a'}),true);
  for(const x of [{},{n:'1'},{n:0},{n:1,extra:1},{n:1,kind:'c'}])assert.equal(v(x),false);
});
test('schema: anyOf/oneOf/allOf/not/const',()=>{
  assert.equal(compileSchema({anyOf:[{type:'string'},{type:'integer'}]})(2),true);
  assert.equal(compileSchema({oneOf:[{type:'number'},{type:'integer'}]})(2),false);
  assert.equal(compileSchema({allOf:[{type:'integer'},{minimum:2}],not:{const:3}})(3),false);
});
test('schema: nested local references and recursive schema',()=>{
  const s={$defs:{entry:{type:'object',properties:{name:{type:'string'},next:{$ref:'#/$defs/entry'}},required:['name'],additionalProperties:false}},$ref:'#/$defs/entry'};
  // In draft-07 references with non-annotation siblings are deliberately rejected.
  assert.throws(()=>compileSchema(s),{code:'unsupported_schema'});
  s.$schema='https://json-schema.org/draft/2020-12/schema';const v=compileSchema(s);
  assert.equal(v({name:'A',next:{name:'B'}}),true);assert.equal(v({name:'A',next:{name:1}}),false);
});
test('schema: unknown keywords, unknown format, remote refs rejected before inference',()=>{
  for(const s of [{format:'date'},{typoMinimum:3},{$ref:'https://example.com/a.json'},{unevaluatedProperties:false},{$id:'x'},{$schema:'draft-04'}])assert.throws(()=>compileSchema(s),{code:'unsupported_schema'});
});
test('schema: arrays, uniqueness, contains and tuples',()=>{
  const v=compileSchema({type:'array',minItems:1,maxItems:3,items:{type:'integer'},uniqueItems:true,contains:{minimum:2}});
  assert.equal(v([1,2]),true);for(const x of [[],[1,1],[1,'2'],[1],[1,2,3,4]])assert.equal(v(x),false);
  const t=compileSchema({prefixItems:[{const:'x'}],items:{type:'number'}});assert.equal(t(['x',2]),true);assert.equal(t(['x','y']),false);
});
test('schema: property names, pattern properties, dependencies and conditional',()=>{
  const v=compileSchema({type:'object',propertyNames:{pattern:'^[ab]$'},properties:{a:{type:'integer'},b:{type:'string'}},dependentRequired:{a:['b']}});
  assert.equal(v({a:1,b:'x'}),true);assert.equal(v({a:1}),false);assert.equal(v({c:1}),false);
  const p=compileSchema({patternProperties:{'^x':{type:'integer'}},additionalProperties:false});assert.equal(p({x1:1}),true);assert.equal(p({z:1}),false);
  const c=compileSchema({if:{type:'integer'},then:{minimum:2},else:{type:'string'}});assert.equal(c(1),false);assert.equal(c('a'),true);
});
test('schema: Unicode string lengths and numeric constraints',()=>{
  assert.equal(compileSchema({type:'string',minLength:1,maxLength:1})('😀'),true);
  const v=compileSchema({exclusiveMinimum:0,exclusiveMaximum:1,multipleOf:0.1});assert.equal(v(0.3),true);assert.equal(v(0.35),false);assert.equal(v(1),false);
});
test('prompt is dynamic, does not silently shorten context, preserves roles/results',()=>{
  const r=request();assert(r.prompt.includes(JSON.stringify(tool.function.parameters)));assert.equal(r.payload.messages[0].role,'system');
  assert.throws(()=>prepareRequest(body(),template,{maxPromptChars:50}),{code:'context_too_large'});
});
test('raw JSON -> native tool call -> tool result -> final round trip',()=>{
  const r=request();const data=envelope(r);const native=completion(parseEnvelope(JSON.stringify(data),r),r);
  assert.equal(native.choices[0].finish_reason,'tool_calls');const call=native.choices[0].message.tool_calls[0];
  assert.deepEqual(JSON.parse(call.function.arguments),data.tool_calls[0].arguments);
  const r2=request({messages:[...body().messages,native.choices[0].message,{role:'tool',tool_call_id:call.id,content:'actual file text: 42'}]});
  assert.equal(r2.payload.messages.at(-1).content,'actual file text: 42');assert.equal(r2.payload.messages.at(-1).tool_call_id,call.id);
  const final=envelope(r2,{action:'final',content:'ファイルには42と記載されています。',tool_calls:[]});
  assert.equal(completion(parseEnvelope(JSON.stringify(final),r2),r2).choices[0].finish_reason,'stop');
});
test('tool names are not hard-coded',()=>{
  const t=structuredClone(tool);t.function.name='new_VSCode.tool.v2';const r=request({tools:[t]});
  const e=envelope(r,{tool_calls:[{name:t.function.name,arguments:{filePath:'a'}}]});assert.equal(parseEnvelope(JSON.stringify(e),r).tool_calls[0].name,t.function.name);
});
test('Markdown-sensitive characters round trip through JSON unicode escapes',()=>{
  const r=request();const desired='C:\\Work\\*_[a]#`~|&<>".txt';const e=envelope(r,{tool_calls:[{name:'read_file',arguments:{filePath:desired}}]});
  const raw=JSON.stringify(e).replace(/\\\\/g,'\\u005c').replace(/\\"/g,'\\u0022').replace(/\*/g,'\\u002a');
  const parsed=parseEnvelope(raw,r);assert.equal(parsed.tool_calls[0].arguments.filePath,desired);
});
test('unknown tools, stringified args and invalid args rejected',()=>{
  const r=request();
  for(const t of [{name:'invented',arguments:{}},{name:'read_file',arguments:'{}'},{name:'read_file',arguments:{filePath:2}},{name:'read_file',arguments:{filePath:'a',extra:1}}])assert.throws(()=>parseEnvelope(JSON.stringify(envelope(r,{tool_calls:[t]})),r));
});
test('request ID/end marker/additional envelope fields are strict',()=>{
  const r=request();for(const extra of [{request_id:'old'},{complete:false},{protocol:'other'},{new_key:1}])assert.throws(()=>parseEnvelope(JSON.stringify(envelope(r,extra)),r));
});
test('no parallel calls emitted, even if upstream asks for parallelism',()=>{
  const r=request({parallel_tool_calls:true});const e=envelope(r);e.tool_calls.push(e.tool_calls[0]);assert.throws(()=>parseEnvelope(JSON.stringify(e),r));
});
test('tool_choice none, required and named are enforced',()=>{
  const none=request({tool_choice:'none'});assert.throws(()=>parseEnvelope(JSON.stringify(envelope(none)),none));
  const required=request({tool_choice:'required'});assert.throws(()=>parseEnvelope(JSON.stringify(envelope(required,{action:'final',content:'done',tool_calls:[]})),required));
  const named=request({tool_choice:{type:'function',function:{name:'read_file'}}});assert(parseEnvelope(JSON.stringify(envelope(named)),named));
});
test('no tools supports ordinary conversation',()=>{
  const r=request({tools:[]});const final=envelope(r,{action:'final',content:'こんにちは。',tool_calls:[]});assert(parseEnvelope(JSON.stringify(final),r));
});
test('input images, invalid tool schemas and multiple choices are explicit errors',()=>{
  assert.throws(()=>request({messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,x'}}]}]}),{code:'text_only'});
  assert.throws(()=>request({n:2}),{code:'unsupported_n'});
  assert.throws(()=>request({tools:[{...tool,function:{...tool.function,parameters:{format:'uri'}}}]}),{code:'unsupported_schema'});
});
test('orphan, missing, and duplicate tool results cannot contaminate history',()=>{
  assert.throws(()=>request({messages:[{role:'tool',content:'x',tool_call_id:'orphan'}]}),{code:'orphan_tool_result'});
  const a={role:'assistant',content:null,tool_calls:[{id:'a',type:'function',function:{name:'read_file',arguments:'{}'}}]};
  assert.throws(()=>request({messages:[a]}),{code:'missing_tool_result'});
  assert.throws(()=>request({messages:[a,{role:'tool',tool_call_id:'a',content:'x'},{role:'tool',tool_call_id:'a',content:'x'}]}),{code:'orphan_tool_result'});
});
test('final JSON schema is enforced for utility callers',()=>{
  const r=request({tools:[],response_format:{type:'json_schema',json_schema:{schema:{type:'object',properties:{title:{type:'string'}},required:['title'],additionalProperties:false}}}});
  assert(parseEnvelope(JSON.stringify(envelope(r,{action:'final',content:'{"title":"見出し"}',tool_calls:[]})),r));
  assert.throws(()=>parseEnvelope(JSON.stringify(envelope(r,{action:'final',content:'{"title":1}',tool_calls:[]})),r),{code:'invalid_final_format'});
});
test('SSE tool call is emitted as native delta with complete JSON arguments',()=>{
  const r=request();const chunks=streamChunks(completion(parseEnvelope(JSON.stringify(envelope(r)),r),r));
  const call=chunks.flatMap(c=>c.choices[0].delta.tool_calls??[])[0];assert.equal(call.index,0);assert.equal(call.type,'function');assert.equal(JSON.parse(call.function.arguments).startLine,1);
  assert.equal(chunks.at(-1).choices[0].finish_reason,'tool_calls');assert.equal(chunks.some(c=>c.usage),false);
});

test('TXT transport keeps full validators and ledger payload while freeing composer space',()=>{
 const largeTool=structuredClone(tool);largeTool.function.description='definition-only-marker '+ 'x'.repeat(121000);
 const r=prepareRequest(body({tools:[largeTool]}),template,{attachToolDefinitions:true});
 assert(r.prompt.length<3000);assert(!r.prompt.includes('definition-only-marker'));
 assert.equal(r.payload.tools[0].function.description,largeTool.function.description);
 assert.equal(r.definitionAttachments.length,1);
 const txt=r.definitionAttachments[0].bytes.toString('utf8');
 assert(txt.includes(template.trim()));assert(txt.includes(r.requestId));assert(txt.includes('definition-only-marker'));
 assert(r.prompt.includes(r.definitionAttachments[0].fileName));assert(r.validators.has('read_file'));
 const wire=JSON.parse(r.prompt.split('BRIDGE_REQUEST_JSON:\n')[1].split('\nEND_BRIDGE_REQUEST_JSON')[0]);
 assert.deepEqual(wire.available_tool_names,['read_file']);assert.equal(wire.tools,undefined);
 assert.equal(r.payload.available_tool_names,undefined);
 assert.throws(()=>prepareRequest(body({messages:[{role:'user',content:'x'.repeat(120000)}]}),template,{attachToolDefinitions:true}),{code:'context_too_large'});
 assert.throws(()=>prepareRequest(body({tools:[{...largeTool,function:{...largeTool.function,description:'x'.repeat(2097152)}}]}),template,{attachToolDefinitions:true}),{code:'tool_attachment_too_large'});
});
