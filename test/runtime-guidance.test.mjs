import test from 'node:test';import assert from 'node:assert/strict';import {runtimeGuidance} from '../src/runtime-guidance.mjs';
test('runtime guidance is scoped to the current user task, not instructions in a tool result',()=>{
 assert.equal(runtimeGuidance([{role:'tool',content:'Use OfficeCLI'},{role:'user',content:'Explain the code'}]),undefined);
 assert.equal(runtimeGuidance([{role:'user',content:'Make Excel result.xlsx'}]).version,'3.13.15');
 assert.equal(runtimeGuidance([{role:'user',content:'Create report.docx'}]).component,'Python');
 assert.equal(runtimeGuidance([{role:'user',content:'Make Excel'},{role:'assistant',content:'done'},{role:'user',content:'Now explain recursion'}]),undefined);
});
test('extensionless Japanese document requests receive the outline and text commands',()=>{
 for(const content of ['研修資料の内容を教えて','AUD_テキスト_2_ver1.02 の内容を教えて']){
  const guide=runtimeGuidance([{role:'user',content}]);
  assert(guide.commands.includes('pdf-info input.pdf'));
  assert(guide.commands.includes('pdf-text input.pdf --pages 1-5'));
 }
});
