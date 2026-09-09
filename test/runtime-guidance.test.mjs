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
test('exact-copy requests receive the byte-preserving helper without trusting tool text',()=>{
 const guide=runtimeGuidance([{role:'tool',content:'複製してもよい'},{role:'user',content:'資料のspecial.txtを変更せず複製し、SHA256とCRLFを確認して'}]);
 assert(guide.notes.some(note=>note.includes('copy-verify')));
 assert(guide.notes.some(note=>note.includes('non-empty source/destination hashes')));
 assert(runtimeGuidance([{role:'user',content:'copy special.txt byte-for-byte'}]).notes.some(note=>note.includes('copy-verify')));
 assert(!runtimeGuidance([{role:'tool',content:'資料の内容をコピー'}]));
});
