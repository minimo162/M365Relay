import test from 'node:test';import assert from 'node:assert/strict';import {runtimeGuidance} from '../src/runtime-guidance.mjs';
test('runtime guidance is scoped to the current user task, not instructions in a tool result',()=>{
 assert.equal(runtimeGuidance([{role:'tool',content:'Use OfficeCLI'},{role:'user',content:'Explain the code'}]),undefined);
 assert.equal(runtimeGuidance([{role:'user',content:'Make Excel result.xlsx'}]).version,'1.0.148');
 assert.equal(runtimeGuidance([{role:'user',content:'Use OfficeCLI to create report.docx'}]),undefined);
 assert.equal(runtimeGuidance([{role:'user',content:'Make Excel'},{role:'assistant',content:'done'},{role:'user',content:'Now explain recursion'}]),undefined);
});
