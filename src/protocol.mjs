import { randomUUID } from 'node:crypto';
import { assert, BridgeError } from './errors.mjs';
import { strictJson, isObject, exactKeys } from './json.mjs';
import { compileSchema } from './schema.mjs';
export const PROTOCOL = 'm365-relay.v1';
export const MODEL = 'm365-copilot-ui';
const transportReminder=String.raw`応答の最終確認: ツール引数のjson-stringではUnicodeエスケープを使います。
文字としてのアンパサンドは \u0026、小なりは \u003c、大なりは \u003e と書きます。
例: 矢印のJSON文字列表現は "x =\u003e x"。実体参照の文字列そのものは "\u0026gt;"。
この2つを混同しないでください。HTML復号も、その逆のHTMLエンコードもしません。
ツールを呼ぶ場合はコードブロックのBRIDGE_TOOL形式と今回のrequest_idを使い、json-stringの中に & < > を直接出力しないでください。
最終回答の場合は指定済みのBRIDGE_FINAL_V2形式を使います。tool_choiceとresponse_formatを守ってください。
作業依頼では、利用者が必須にした未実施の確認・処理を、今回のツールで実行できるなら次のツールを選びます。「未確認」と書くことは必須作業の代わりになりません。
中止・状況報告・会話要約だけを求める今回の要求はその指定を優先します。実際の拒否・権限不足・情報不足・tool_choice制約で続行できない場合は理由を最終回答します。`;
const toolName = /^[A-Za-z0-9_.:-]{1,128}$/;
function textContent(c) {
  if (c === null || c === undefined) return null;
  if (typeof c === 'string') return c;
  assert(Array.isArray(c) && c.every(p => isObject(p) && p.type === 'text' && typeof p.text === 'string'), 'text_only', '初版はテキストのみです。画像・音声・バイナリは黙って捨てません。');
  return c.map(p => ({ type: 'text', text: p.text }));
}

function toolRoundInfo(messages) {
  let start=0;
  for(let i=messages.length-1;i>=0;i--){
    if(messages[i]?.role==='user'){start=i+1;break;}
  }
  let total=0,terminal=0;
  for(let i=start;i<messages.length;i++){
    const m=messages[i];
    if(m?.role!=='assistant'||!Array.isArray(m.tool_calls))continue;
    total+=m.tool_calls.length;
    for(const c of m.tool_calls)if(c?.function?.name==='run_in_terminal')terminal++;
  }
  return {total,terminal};
}
export function prepareRequest(body, promptTemplate, { maxPromptChars = 120000, model = MODEL } = {}) {
  assert(isObject(body) && body.model === model, 'unknown_model', '設定済みのモデル ID を指定してください。');
  assert(Array.isArray(body.messages) && body.messages.length > 0 && body.messages.length <= 512, 'messages_required', 'messages が必要です（最大512件）。');
  assert(body.n === undefined || body.n === 1, 'unsupported_n', 'n=1 のみ対応しています。');
  assert(body.stream === undefined || typeof body.stream === 'boolean', 'invalid_stream', 'stream は真偽値です。');
  assert(body.stop === undefined || body.stop === null || Array.isArray(body.stop) && body.stop.length === 0, 'unsupported_stop', 'stop による JSON の途中切断には対応していません。');
  assert(!body.functions && !body.function_call, 'legacy_functions', '旧式の functions ではなく tools を使用してください。');
  assert(!body.modalities || body.modalities.length === 1 && body.modalities[0] === 'text', 'text_only', 'テキストのみ対応しています。');
  const messages = body.messages.map(m => {
    assert(isObject(m) && ['system','developer','user','assistant','tool'].includes(m.role), 'invalid_role', '未対応のメッセージ role です。');
    const out = { role: m.role, content: textContent(m.content) };
    if (m.name !== undefined) { assert(typeof m.name === 'string', 'invalid_name', 'name は文字列です。'); out.name = m.name; }
    if (m.role === 'tool') { assert(typeof m.tool_call_id === 'string' && m.tool_call_id.length > 0, 'missing_call_id', 'tool の tool_call_id が必要です。'); out.tool_call_id = m.tool_call_id; }
    if (m.tool_calls !== undefined) {
      assert(m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0, 'invalid_history', '過去のツール呼び出しが不正です。');
      out.tool_calls = m.tool_calls.map(t => {
        assert(isObject(t) && t.type === 'function' && typeof t.id === 'string' && isObject(t.function) && toolName.test(t.function.name) && typeof t.function.arguments === 'string', 'invalid_history', '過去のツール呼び出しが不正です。');
        assert(isObject(strictJson(t.function.arguments)), 'invalid_history', '過去の引数はJSONオブジェクトである必要があります。');
        return { id: t.id, type:'function', function: {name:t.function.name, arguments:t.function.arguments} };
      });
    }
    return out;
  });
  const pending = new Set(); const seen = new Set();
  for (const m of messages) {
    if (m.role === 'tool') { assert(pending.delete(m.tool_call_id), 'orphan_tool_result', '対応する呼び出しのないツール結果があります。'); continue; }
    assert(pending.size === 0, 'missing_tool_result', '前のツール呼び出しの結果が不足しています。');
    for (const t of m.tool_calls ?? []) { assert(!seen.has(t.id), 'duplicate_call_id', 'ツール呼び出しIDが重複しています。'); seen.add(t.id); pending.add(t.id); }
  }
  assert(pending.size === 0, 'missing_tool_result', 'ツール結果を受け取る前には次の判断を行いません。');
  assert(body.tools === undefined || Array.isArray(body.tools), 'invalid_tools', 'tools は配列です。');
  const validators = new Map();
  const tools = (body.tools ?? []).map(t => {
    assert(isObject(t) && t.type === 'function' && isObject(t.function) && typeof t.function.name === 'string' && toolName.test(t.function.name), 'invalid_tool', 'function 形式のツールが必要です。');
    const f = t.function;
    assert(!validators.has(f.name), 'duplicate_tool', 'ツール名が重複しています。');
    assert(f.description === undefined || typeof f.description === 'string', 'invalid_tool', 'description は文字列です。');
    const schema = f.parameters ?? {type:'object', properties:{}, additionalProperties:false};
    assert(isObject(schema) || typeof schema === 'boolean', 'invalid_schema', 'parameters はJSON Schemaです。');
    validators.set(f.name, compileSchema(schema, { toolName: f.name }));
    return { type:'function', function:{ name:f.name, description:f.description ?? '', parameters:schema } };
  });
  assert(tools.length <= 128, 'too_many_tools', '一度に渡すツールは最大128件です。');
  const choice = body.tool_choice ?? (tools.length ? 'auto' : 'none');
  assert(['auto','none','required'].includes(choice) || isObject(choice) && choice.type === 'function' && isObject(choice.function) && validators.has(choice.function.name), 'invalid_tool_choice', 'tool_choice が不正です。');
  assert(choice !== 'required' || tools.length > 0, 'required_without_tools', 'required にはツールが必要です。');
  const format = body.response_format ?? { type:'text' };
  assert(isObject(format) && ['text','json_object','json_schema'].includes(format.type), 'invalid_response_format', '未対応の response_format です。');
  let finalValidator;
  if (format.type === 'json_schema') {
    assert(isObject(format.json_schema) && Object.hasOwn(format.json_schema,'schema'), 'invalid_response_format', 'json_schema.schema が必要です。');
    finalValidator = compileSchema(format.json_schema.schema, { source: 'response_format' });
  }
  const requestId = randomUUID();
  const toolRounds = toolRoundInfo(messages);
  const toolBudget = { totalUsed:toolRounds.total, terminalUsed:toolRounds.terminal, maxTotal:12, maxTerminal:3 };
  const payload = {
    protocol:PROTOCOL, request_id:requestId, messages, tools, tool_choice:choice,
    response_format:format, max_tool_calls_per_response:1,
    generation_hints:Object.fromEntries(['temperature','top_p','max_tokens','max_completion_tokens','reasoning_effort'].filter(k=>body[k]!==undefined).map(k=>[k,body[k]]))
  };
  // Keep HTML-like text out of the literal UI payload. JSON Unicode escapes
  // preserve the exact values while avoiding entity interpretation upstream.
  const serialized=JSON.stringify(payload).replace(/[&<>]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  const prompt = `${promptTemplate.trim()}\n\nBRIDGE_REQUEST_ID: ${requestId}\nBRIDGE_REQUEST_JSON:\n${serialized}\nEND_BRIDGE_REQUEST_JSON\n${transportReminder}\n`;
  const promptLimit=Math.min(maxPromptChars,120000);
  if(prompt.length>promptLimit)throw new BridgeError('context_too_large', '会話とツール定義が入力上限を超えました。会話を圧縮するか、選択ツールを減らしてください。本文は切り捨てず、M365への送信前に停止しました。', 413,
    {prompt_chars:prompt.length,max_prompt_chars:promptLimit});
  return { body, payload, prompt, requestId, validators, finalValidator, model, stream:body.stream === true, toolBudget };
}

function normalizeInvalidWindowsPathStrings(text) {
  let out='',i=0,changed=false;
  while(i<text.length){
    if(text[i]!=="\""){out+=text[i++];continue;}
    const start=i;let j=i+1,raw='',closed=false;
    while(j<text.length){
      const c=text[j];
      if(c==="\""){closed=true;j++;break;}
      if(c==='\\' && j+1<text.length){raw+=c+text[j+1];j+=2;continue;}
      raw+=c;j++;
    }
    if(!closed){out+=text.slice(start);break;}
    const drive=/^[A-Za-z]:\\/.test(raw);
    const hasUnsafe=drive && /\\(?!u005c)/i.test(raw);
    if(!hasUnsafe){out+=text.slice(start,j);i=j;continue;}
    let fixed='';
    for(let k=0;k<raw.length;k++){
      if(raw[k]!=='\\'){fixed+=raw[k];continue;}
      if(/^\\u005c/i.test(raw.slice(k,k+6))){fixed+='/';k+=5;continue;}
      fixed+='/';
    }
    out+='\"'+fixed+'\"';changed=true;i=j;
  }
  return changed?out:text;
}

function controlLine(s) {
  return s.replace(/\\_/g,'_');
}
function decodePointerSegment(s) {
  return s.replace(/~1/g,'/').replace(/~0/g,'~');
}
function setPointer(root,pointer,value) {
  assert(pointer.startsWith('/')&&pointer.length>1,'invalid_envelope','ARG path が不正です。',502);
  const parts=pointer.slice(1).split('/').map(decodePointerSegment);
  assert(parts.every(x=>x.length>0&&!['__proto__','prototype','constructor'].includes(x)),'invalid_envelope','ARG path が不正です。',502);
  let cur=root;
  for(let i=0;i<parts.length;i++){
    const key=parts[i],last=i===parts.length-1,next=parts[i+1];
    const index=Array.isArray(cur)?Number(key):null;
    if(Array.isArray(cur))assert(Number.isInteger(index)&&index>=0&&String(index)===key,'invalid_envelope','配列ARG path が不正です。',502);
    if(last){
      if(Array.isArray(cur))assert(cur[index]===undefined,'invalid_envelope','ARG path が重複しています。',502),cur[index]=value;
      else assert(!Object.hasOwn(cur,key),'invalid_envelope','ARG path が重複しています。',502),cur[key]=value;
      return;
    }
    const makeArray=/^(0|[1-9]\d*)$/.test(next);
    if(Array.isArray(cur)){
      if(cur[index]===undefined)cur[index]=makeArray?[]:{};
      assert(Array.isArray(cur[index])===makeArray,'invalid_envelope','ARG path が競合しています。',502);
      cur=cur[index];
    }else{
      if(!Object.hasOwn(cur,key))cur[key]=makeArray?[]:{};
      assert(Array.isArray(cur[key])===makeArray,'invalid_envelope','ARG path が競合しています。',502);
      cur=cur[key];
    }
  }
}

function assertToolBudget(req,name) {
  const b=req.toolBudget??{totalUsed:0,terminalUsed:0,maxTotal:12,maxTerminal:3};
  assert(b.totalUsed<b.maxTotal,'tool_loop_detected',
    'ツール呼び出し回数が上限に達しました。同じ処理を繰り返さず、取得済み情報と失敗理由を利用者へ説明してください。',502,
    {stage:'tool_budget',tool_rounds:b.totalUsed,max_tool_rounds:b.maxTotal});
  if(name==='run_in_terminal')assert(b.terminalUsed<b.maxTerminal,'tool_loop_detected',
    'ターミナル実行を繰り返しています。同じ依存関係・コマンド方式を再試行せず、別手段へ切り替えるか利用者へ制約を説明してください。',502,
    {stage:'tool_budget',terminal_rounds:b.terminalUsed,max_terminal_rounds:b.maxTerminal});
}
function parseRawTool(text,req) {
  const head=/^BRIDGE(?:_|\\_)TOOL\s+([a-f0-9-]{36})(?:\s+|$)/i.exec(text);
  if(!head)return null;
  assert(head[1]===req.requestId,'invalid_envelope','tool の request_id が一致しません。',502);
  assert(Buffer.byteLength(text,'utf8')<=1024*1024,'invalid_envelope','ツール応答が大きすぎます。',502);

  let pos=head[0].length;
  const skipWs=()=>{while(pos<text.length&&/\s/.test(text[pos]))pos++;};
  const findEnd=(kind)=>{
    const source={
      content:'\\s+END(?:_|\\\\_)CONTENT(?=\\s|$)',
      arg:'\\s+END(?:_|\\\\_)ARG(?=\\s|$)'
    }[kind];
    const r=new RegExp(source,'ig');
    r.lastIndex=pos;
    return r.exec(text);
  };
  const findJsonStringEnd=()=>{
    let i=pos;while(i<text.length&&/\s/.test(text[i]))i++;
    assert(text[i]==='"','invalid_envelope','json-string ARG は引用符で開始する必要があります。',502);
    for(i++;i<text.length;i++){
      if(text[i]==='\\'){i++;continue;}
      if(text[i]!=='"')continue;
      const end=i+1;
      const marker=/^\s+END(?:_|\\_)ARG(?=\s|$)/i.exec(text.slice(end));
      assert(marker,'invalid_envelope','json-string ARG 終端がありません。',502);
      return {index:end,0:marker[0]};
    }
    throw new BridgeError('invalid_envelope','json-string ARG が途中で終了しています。',502);
  };

  skipWs();
  const nm=/^NAME\s+([A-Za-z0-9_.:-]{1,128})(?=\s|$)/i.exec(text.slice(pos));
  assert(nm,'invalid_envelope','NAME が不正です。',502);
  const name=nm[1];
  pos+=nm[0].length;

  let content='';
  skipWs();
  const cm=/^CONTENT(?=\s|$)/i.exec(text.slice(pos));
  if(cm){
    pos+=cm[0].length;
    const e=findEnd('content');
    assert(e,'invalid_envelope','CONTENT 終端がありません。',502);
    content=text.slice(pos,e.index).replace(/^\s+/,'').replace(/\s+$/,'');
    pos=e.index+e[0].length;
  }

  const args={};let count=0;
  for(;;){
    skipWs();
    const tail=/^END(?:_|\\_)BRIDGE(?:_|\\_)TOOL(?=\s*$)/i.exec(text.slice(pos));
    if(tail){pos+=tail[0].length;break;}

    const hm=/^ARG\s+(\/\S+)\s+(json-string|string|number|integer|boolean|null|object|array|json)(?=\s|$)/i.exec(text.slice(pos));
    assert(hm,'invalid_envelope','ARG ヘッダーが不正です。',502);
    pos+=hm[0].length;

    const type=hm[2].toLowerCase();
    const e=type==='json-string'?findJsonStringEnd():findEnd('arg');
    assert(e,'invalid_envelope','ARG 終端がありません。',502);
    let raw=text.slice(pos,e.index).replace(/^\s+/,'').replace(/\s+$/,'');

    let value;
    if(type==='json-string'){
      value=strictJson(raw,{maxBytes:256*1024});
      assert(typeof value==='string','invalid_envelope','json-string ARG はJSON文字列である必要があります。',502);
    }
    else if(type==='string')value=raw;
    else if(type==='null'){assert(raw===''||raw==='null','invalid_envelope','null ARG が不正です。',502);value=null;}
    else if(type==='boolean'){assert(/^(true|false)$/.test(raw),'invalid_envelope','boolean ARG が不正です。',502);value=raw==='true';}
    else if(type==='integer'){assert(/^-?(0|[1-9]\d*)$/.test(raw),'invalid_envelope','integer ARG が不正です。',502);value=Number(raw);assert(Number.isSafeInteger(value),'invalid_envelope','integer ARG が範囲外です。',502);}
    else if(type==='number'){assert(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw),'invalid_envelope','number ARG が不正です。',502);value=Number(raw);assert(Number.isFinite(value),'invalid_envelope','number ARG が範囲外です。',502);}
    else if(type==='object'){assert(raw===''||raw==='{}','invalid_envelope','object ARG は空オブジェクトのみ直接指定できます。',502);value={};}
    else if(type==='array'){assert(raw===''||raw==='[]','invalid_envelope','array ARG は空配列のみ直接指定できます。',502);value=[];}
    else value=strictJson(raw,{maxBytes:256*1024});

    setPointer(args,hm[1],value);
    count++;
    assert(count<=256,'invalid_envelope','ARG が多すぎます。',502);
    pos=e.index+e[0].length;
  }

  assert(text.slice(pos).trim()==='','invalid_envelope','ツール応答の終端後に余分な内容があります。',502);
  assertToolBudget(req,name);
  const choice=req.payload.tool_choice;
  assert(choice!=='none'&&req.validators.has(name),'tool_choice_violation','今回はこのツール呼び出しを受理できません。',502);
  assert(!isObject(choice)||choice.function.name===name,'tool_choice_violation','指定されたツール名と一致しません。',502);
  assert(req.validators.get(name)(args),'invalid_tool_arguments','引数がVS Codeから渡されたJSON Schemaに適合しません。',502);
  return {protocol:PROTOCOL,request_id:req.requestId,action:'tool_calls',content,tool_calls:[{name,arguments:args}],complete:true};
}

export function parseEnvelope(raw, req) {
  let text = raw.trim();
  // Strip only a complete outer transport fence. The contents are still parsed
  // strictly; do not extract an apparently valid substring from surrounding prose.
  const transportFence=/^(`{3,})(?:text|json)?[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/i.exec(text);
  if(transportFence)text=transportFence[2];

  const rawTool=parseRawTool(text,req);
  if(rawTool)return rawTool;

  const finalHead=/^BRIDGE(?:_|\\_)FINAL((?:_|\\_)V2)?\s+([a-f0-9-]{36})(?:(?:[ \t]*\n)|[ \t]+|$)/i.exec(text);
  if(finalHead){
    assert(finalHead[2]===req.requestId,'invalid_envelope','final の request_id が一致しません。',502);
    let content=text.slice(finalHead[0].length);
    if(finalHead[1]){
      assert(/\r?\nEND_BRIDGE_FINAL_V2[ \t]*$/i.test(content),'invalid_envelope','final の終端がありません。',502);
      content=content.replace(/\r?\nEND_BRIDGE_FINAL_V2[ \t]*$/i,'');
    }
    const choice=req.payload.tool_choice;
    assert(content.trim().length>0,'invalid_envelope','final の内容が空です。',502);
    assert(choice!=='required'&&!isObject(choice),'tool_choice_violation','この要求では final を返せません。',502);
    if(req.payload.response_format.type!=='text'){
      const data=strictJson(content);
      assert(req.payload.response_format.type!=='json_object'||isObject(data),'invalid_final_format','content はJSONオブジェクトである必要があります。',502);
      assert(!req.finalValidator||req.finalValidator(data),'invalid_final_format','content が要求されたJSON Schemaに適合しません。',502);
    }
    return {protocol:PROTOCOL,request_id:req.requestId,action:'final',content,tool_calls:[],complete:true};
  }

  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  if (fence) text = fence[1].trim();
  let out;
  try{out=strictJson(text,{maxBytes:1024*1024});}
  catch(error){
    if(error?.code!=='invalid_json')throw error;
    const normalized=normalizeInvalidWindowsPathStrings(text);
    if(normalized===text)throw error;
    out=strictJson(normalized,{maxBytes:1024*1024});
  }
  assert(exactKeys(out,['protocol','request_id','action','content','tool_calls','complete']), 'invalid_envelope', '回答のフィールドが出力契約と一致しません。', 502);
  assert(out.protocol === PROTOCOL && out.request_id === req.requestId && out.complete === true, 'response_mismatch', '回答ID・プロトコル・終端を照合できません。', 502);
  assert(['tool_calls','final'].includes(out.action) && typeof out.content === 'string' && Array.isArray(out.tool_calls), 'invalid_envelope', '回答の型が出力契約と一致しません。', 502);
  const choice = req.payload.tool_choice;
  if (out.action === 'tool_calls') {
    assert(choice !== 'none' && out.tool_calls.length === 1, 'tool_choice_violation', '今回はこのツール呼び出しを受理できません。', 502);
    const t = out.tool_calls[0];
    assertToolBudget(req,t.name);
    assert(exactKeys(t,['name','arguments']) && typeof t.name === 'string' && isObject(t.arguments) && req.validators.has(t.name), 'unknown_tool', '未登録ツールまたは不正な引数形式です。', 502);
    assert(!isObject(choice) || choice.function.name === t.name, 'tool_choice_violation', '指定されたツール名と一致しません。', 502);
    assert(req.validators.get(t.name)(t.arguments), 'invalid_tool_arguments', '引数がVS Codeから渡されたJSON Schemaに適合しません。', 502);
  } else {
    assert(out.tool_calls.length === 0 && out.content.trim().length > 0 && choice !== 'required' && !isObject(choice), 'tool_choice_violation', 'final の内容またはtool_choiceが不正です。', 502);
    if (req.payload.response_format.type !== 'text') {
      const data = strictJson(out.content);
      assert(req.payload.response_format.type !== 'json_object' || isObject(data), 'invalid_final_format', 'content はJSONオブジェクトである必要があります。', 502);
      assert(!req.finalValidator || req.finalValidator(data), 'invalid_final_format', 'content が要求されたJSON Schemaに適合しません。', 502);
    }
  }
  return out;
}
export function completion(out, req) {
  const message = {role:'assistant', content:out.content || null};
  if (out.action === 'tool_calls') message.tool_calls = out.tool_calls.map(t => ({
    id:`call_${randomUUID().replaceAll('-','')}`, type:'function', function:{name:t.name,arguments:JSON.stringify(t.arguments)}
  }));
  return { id:`chatcmpl_${req.requestId}`, object:'chat.completion', created:Math.floor(Date.now()/1000), model:req.model,
    choices:[{index:0, message, finish_reason:out.action === 'tool_calls' ? 'tool_calls':'stop'}] };
}
export function streamChunks(result) {
  const base = {id:result.id,object:'chat.completion.chunk',created:result.created,model:result.model};
  const chunk = (delta, finish_reason = null) => ({...base,choices:[{index:0,delta,finish_reason}]});
  const m=result.choices[0].message;
  const out=[chunk({role:'assistant'})];
  if (m.content) out.push(chunk({content:m.content}));
  if (m.tool_calls) out.push(chunk({tool_calls:m.tool_calls.map((t,index)=>({index,...t}))}));
  out.push(chunk({},result.choices[0].finish_reason)); return out;
}
