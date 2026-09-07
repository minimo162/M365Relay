import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileSchema } from '../src/schema.mjs';
import { prepareRequest, parseEnvelope, completion, MODEL, PROTOCOL } from '../src/protocol.mjs';
import { publicError } from '../src/errors.mjs';
import { createBridgeServer } from '../src/server.mjs';
import { Ledger } from '../src/state.mjs';
const template = await readFile(new URL('../prompts/m365-tool-router.md', import.meta.url), 'utf8');
// Structural regression derived from VS Code's built-in runInTerminalTool at
// 520fb30b2d3d324b4cb2342f6e88e2cd93751de1 (mode.enumDescriptions).
// Descriptions are synthetic; no user's request or actual terminal execution is involved.
const schema = {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'Test command, never executed.' },
    explanation: { type: 'string' }, goal: { type: 'string' },
    mode: { type: 'string', enum: ['sync', 'async'], enumDescriptions: ['Wait for completion.', 'Return while running.'] },
    isBackground: { type: 'boolean' }, timeout: { type: 'number' }
  },
  required: ['command', 'explanation', 'goal', 'mode']
};
const tool = { type: 'function', function: { name: 'run_in_terminal', parameters: schema } };
const body = (tools = [tool]) => ({ model: MODEL, messages: [{ role: 'user', content: 'synthetic fixture' }], tools });
const args = { command: 'echo fixture', explanation: 'Test only', goal: 'Compatibility', mode: 'sync' };
function answer(req, arguments_ = args) {
  return JSON.stringify({ protocol: PROTOCOL, request_id: req.requestId, action: 'tool_calls', content: '',
    tool_calls: [{ name: 'run_in_terminal', arguments: arguments_ }], complete: true });
}

test('VS Code terminal enumDescriptions passes and remains in the M365 prompt', () => {
  const before = structuredClone(schema);
  const req = prepareRequest(body(), template);
  assert.deepEqual(schema, before);
  assert.deepEqual(req.payload.tools[0].function.parameters, schema);
  assert(req.prompt.includes('enumDescriptions'));
  assert(req.validators.get('run_in_terminal')(args));
});

test('native tool call retains enum, type and required constraints', () => {
  const req = prepareRequest(body(), template);
  const result = completion(parseEnvelope(answer(req), req), req);
  assert.equal(result.choices[0].finish_reason, 'tool_calls');
  assert.deepEqual(JSON.parse(result.choices[0].message.tool_calls[0].function.arguments), args);
  for (const invalid of [{ ...args, mode: 'invalid' }, { ...args, mode: true }, { ...args, timeout: '1' }, { command: 'echo' }]) {
    assert.throws(() => parseEnvelope(answer(req, invalid), req), { code: 'invalid_tool_arguments' });
  }
});

for (const annotation of ['enumDescriptions', 'markdownEnumDescriptions', 'enumItemLabels']) {
  test(`VS Code ${annotation} is annotation-only, including nested schema`, () => {
    const validate = compileSchema({ type: 'array', items: {
      type: 'object', properties: { mode: { type: 'string', enum: ['sync'], [annotation]: ['label'] } },
      required: ['mode'], additionalProperties: false
    }});
    assert(validate([{ mode: 'sync' }]));
    assert.equal(validate([{ mode: 'other' }]), false);
    assert.equal(validate([{ mode: 'sync', extra: 1 }]), false);
    assert.equal(validate([{}]), false);
  });
}

test('malformed display annotations remain errors with tool context', () => {
  for (const value of ['not-an-array', [1], null]) {
    assert.throws(() => compileSchema({ enum: ['a'], enumDescriptions: value }, { toolName: 'native_tool' }),
      e => e.code === 'unsupported_schema' && e.details.tool_name === 'native_tool' && e.details.schema_keyword === 'enumDescriptions');
  }
});

test('unsupported constraints are not ignored and identify the affected tool', () => {
  const blocked = { type: 'function', function: { name: 'native_tool', parameters: {
    type: 'object', properties: { value: { type: 'string', format: 'uri', description: 'SECRET_DESCRIPTION', default: 'SECRET_VALUE' } }
  }}};
  assert.throws(() => prepareRequest(body([blocked]), template), e => {
    assert.equal(e.code, 'unsupported_schema');
    assert.match(e.message, /native_tool/);
    assert.match(e.message, /format/);
    assert.deepEqual(e.details, { schema_keyword: 'format', schema_source: 'tool', tool_name: 'native_tool' });
    assert.doesNotMatch(JSON.stringify(publicError(e)), /SECRET/);
    return true;
  });
  assert.throws(() => compileSchema({ unevaluatedProperties: false }), { code: 'unsupported_schema' });
});

test('arbitrary schema keys and values are not exposed in public errors', () => {
  assert.throws(() => compileSchema({ PRIVATE_SCHEMA_KEY: 'PRIVATE_VALUE' }, { toolName: 'native_tool' }), e => {
    assert.equal(e.details.schema_keyword, 'unknown_or_invalid');
    assert.doesNotMatch(JSON.stringify(publicError(e)), /PRIVATE/);
    return true;
  });
});

test('response_format schema failures are distinguished from tool failures', () => {
  assert.throws(() => prepareRequest({ ...body([]), response_format: {
    type: 'json_schema', json_schema: { schema: { type: 'string', format: 'uri' } }
  }}, template), e => e.details.schema_source === 'response_format' && !e.details.tool_name && /response_format/.test(e.message));
});

test('annotation on draft-07 reference is preserved without weakening the reference', () => {
  const validate = compileSchema({ type: 'object', definitions: { value: { enum: ['a'] } },
    properties: { value: { $ref: '#/definitions/value', enumDescriptions: ['Only a'] } } });
  assert(validate({ value: 'a' }));
  assert.equal(validate({ value: 'b' }), false);
});

test('HTTP annotated schema reaches mock backend; unsupported schema never reaches it', async t => {
  const home = await mkdtemp(join(tmpdir(), 'relay-schema-'));
  const token = 'b'.repeat(64);
  const ledger = new Ledger(home, token); await ledger.load();
  const log = []; let calls = 0;
  const server = createBridgeServer({
    config: { token, home, maxQueue: 2, requestTimeoutMs: 3000, maxPromptChars: 180000 }, template, ledger,
    backend: { complete: async (req, opts) => { calls++; await opts.onBeforeSend(); return answer(req); } },
    log: item => log.push(item)
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await server.stop(); await rm(home, { recursive: true, force: true }); });
  const post = payload => fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const good = await post(body());
  assert.equal(good.status, 200);
  assert.equal((await good.json()).choices[0].finish_reason, 'tool_calls');
  const blocked = await post(body([{ type: 'function', function: { name: 'native_tool', parameters: { format: 'PRIVATE_VALUE' } } }]));
  assert.equal(blocked.status, 400);
  const error = (await blocked.json()).error;
  assert.equal(error.details.tool_name, 'native_tool');
  assert.equal(error.details.schema_keyword, 'format');
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(error), /PRIVATE_VALUE/);
  assert.doesNotMatch(JSON.stringify(log), /PRIVATE_VALUE|synthetic fixture|enumDescriptions|Bearer/);
});
