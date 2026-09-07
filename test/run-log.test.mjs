import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,dirname,resolve,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createRunLog} from '../src/run-log.mjs';
async function home(t){const path=await mkdtemp(join(tmpdir(),'relay-log-'));t.after(async()=>{assert.equal(dirname(resolve(path)),resolve(tmpdir()));assert(basename(path).startsWith('relay-log-'));await rm(path,{recursive:true,force:true});});return path;}

test('run log preserves timings but excludes message bodies and credentials',async t=>{
 const printed=[],logger=await createRunLog(await home(t),{print:s=>printed.push(s)});
 logger.log({event:'accepted',prompt_chars:100,tools:2,prompt:'PRIVATE',authorization:'SECRET'});
 logger.log({event:'backend_timing',outcome:'success',total_ms:12,phase_ms:{editor_stable:5,send_ready:3,PRIVATE:9},content:'PRIVATE'});
 logger.log({event:'response_returned',kind:'final'});await logger.flush();
 const text=await readFile(logger.path,'utf8');assert(!/PRIVATE|SECRET/.test(text));
 const rows=text.trim().split('\n').map(JSON.parse);assert.equal(rows[1].phase_ms.editor_stable,5);assert.equal(rows[1].phase_ms.send_ready,3);
 assert.equal(printed.length,2);assert(!printed.join('').includes('backend_timing'));
});

test('run log write failure and size cap do not stop status reporting',async t=>{
 const printed=[],warnings=[];let attempts=0;
 const logger=await createRunLog(await home(t),{print:s=>printed.push(s),warn:s=>warnings.push(s),append:async()=>{attempts++;throw new Error('PRIVATE failure');}});
 logger.log({event:'accepted'});await logger.flush();logger.log({event:'response_returned',kind:'final'});await logger.flush();
 assert.equal(attempts,1);assert.equal(printed.length,2);assert.equal(warnings.length,1);assert(!warnings[0].includes('PRIVATE'));
 const capped=await createRunLog(await home(t),{print:s=>printed.push(s),warn:s=>warnings.push(s),maxBytes:1,append:async()=>assert.fail('over-limit write')});
 capped.log({event:'accepted'});await capped.flush();assert.equal(warnings.length,2);
});
