import { randomUUID } from 'node:crypto';
import { assert, BridgeError } from './errors.mjs';
import { strictJson, isObject, exactKeys } from './json.mjs';
import { compileSchema } from './schema.mjs';
export const PROTOCOL = 'm365-relay.v1';
export const MODEL = 'm365-copilot-ui';
const toolName = /^[A-Za-z0-9_.:-]{1,128}$/;
function textContent(c) {
  if (c === null || c === undefined) return null;
  if (typeof c === 'string') return c;
  assert(Array.isArray(c) && c.every(p => isObject(p) && p.type === 'text' && typeof p.text === 'string'), 'text_only', '初版はテキストのみです。画像・音声・バイナリは黙って捨てません。');
  return c.map(p => ({ type: 'text', text: p.text }));
}
export function prepareRequest(body, promptTemplate, { maxPromptChars = 180000, model = MODEL } = {}) {
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
  // Every tool result must match an outstanding call. Never relabel data as a user message.
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
    validators.set(f.name, compileSchema(schema));
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
    finalValidator = compileSchema(format.json_schema.schema);
  }
  const requestId = randomUUID();
  const payload = {
    protocol:PROTOCOL, request_id:requestId, messages, tools, tool_choice:choice,
    response_format:format, max_tool_calls_per_response:1,
    generation_hints:Object.fromEntries(['temperature','top_p','max_tokens','max_completion_tokens','reasoning_effort'].filter(k=>body[k]!==undefined).map(k=>[k,body[k]]))
  };
  const prompt = `${promptTemplate.trim()}\n\nBRIDGE_REQUEST_ID: ${requestId}\nBRIDGE_REQUEST_JSON:\n${JSON.stringify(payload)}\n`;
  assert(prompt.length <= maxPromptChars, 'context_too_large', '会話とツール定義が入力上限を超えました。自動で切り捨てません。利用ツールや対象範囲を減らしてください。', 413);
  return { body, payload, prompt, requestId, validators, finalValidator, model, stream:body.stream === true };
}
export function parseEnvelope(raw, req) {
  // Only an exact surrounding JSON code fence is tolerated; never salvage a substring or add braces.
  let text = raw.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  if (fence) text = fence[1].trim();
  const out = strictJson(text, {maxBytes:1024*1024});
  assert(exactKeys(out,['protocol','request_id','action','content','tool_calls','complete']), 'invalid_envelope', '回答のフィールドが出力契約と一致しません。', 502);
  assert(out.protocol === PROTOCOL && out.request_id === req.requestId && out.complete === true, 'response_mismatch', '回答ID・プロトコル・終端を照合できません。', 502);
  assert(['tool_calls','final'].includes(out.action) && typeof out.content === 'string' && Array.isArray(out.tool_calls), 'invalid_envelope', '回答の型が出力契約と一致しません。', 502);
  const choice = req.payload.tool_choice;
  if (out.action === 'tool_calls') {
    assert(choice !== 'none' && out.tool_calls.length === 1, 'tool_choice_violation', '今回はこのツール呼び出しを受理できません。', 502);
    const t = out.tool_calls[0];
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
