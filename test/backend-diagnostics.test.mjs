import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { M365Backend } from '../src/m365.mjs';
import { MODEL,prepareRequest } from '../src/protocol.mjs';
import { safeDiagnostics } from '../src/diagnostics.mjs';
const template=await readFile(new URL('../prompts/m365-tool-router.md',import.meta.url),'utf8');
const base=JSON.parse(await readFile(new URL('../config/settings.example.json',import.meta.url),'utf8'));
const request=prepareRequest({model:MODEL,messages:[{role:'user',content:'x'}]},template);
test('unexpected backend exceptions become safe staged bridge errors instead of HTTP 500 causes',async()=>{
  const backend=new M365Backend(base,{connect:async()=>{throw new TypeError('SECRET INTERNAL STACK');}});
  await assert.rejects(backend.complete(request,{signal:AbortSignal.timeout(1000),onBeforeSend:async()=>{}}),error=>{
    assert.equal(error.code,'backend_internal_error');assert.equal(error.status,502);
    assert.deepEqual(safeDiagnostics(error.details),{stage:'backend',backend_phase:'connect',total_prompt_chars:request.prompt.length});
    assert.doesNotMatch(error.message,/SECRET|STACK/);return true;
  });
});

test('new readiness phases and booleans survive filtering while arbitrary values do not',()=>{
 for(const phase of ['editor_stable','send_ready'])assert.equal(safeDiagnostics({backend_phase:phase}).backend_phase,phase);
 assert.deepEqual(safeDiagnostics({stage:'send_ready',button_found:true,button_enabled:false,busy:false,html:'PRIVATE',buttonText:'PRIVATE'}),{stage:'send_ready',button_found:true,button_enabled:false,busy:false});
 assert.deepEqual(safeDiagnostics({stage:'PRIVATE',backend_phase:'PRIVATE',button_found:'PRIVATE'}),{});
});
