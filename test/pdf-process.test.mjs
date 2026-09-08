import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runPdfWorker} from '../src/pdf-process.mjs';
async function fixture(t,source){const dir=await mkdtemp(join(tmpdir(),'relay-pdf-worker-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'worker.mjs');await writeFile(path,source);return path;}
test('parser process result requires clean exit',async t=>{
 const worker=await fixture(t,"process.send('result',()=>process.exit(0));");
 assert.equal(await runPdfWorker(worker,[],{timeoutMs:5000}),'result');
 const crashed=await fixture(t,"process.send('partial',()=>process.exit(7));");
 await assert.rejects(runPdfWorker(crashed,[],{timeoutMs:5000}),{code:'PDF_WORKER_FAILED'});
});
test('synchronous native-like hang is killed even after sending a result',async t=>{
 const worker=await fixture(t,"process.send('partial',()=>{while(true){}});");
 await assert.rejects(runPdfWorker(worker,[],{timeoutMs:1000}),{code:'PDF_TIMEOUT'});
});
test('cancellation terminates owned process and pre-abort does not launch it',async t=>{
 const worker=await fixture(t,"while(true){}");const controller=new AbortController();
 const running=runPdfWorker(worker,[],{timeoutMs:5000,signal:controller.signal});controller.abort();
 await assert.rejects(running,{code:'PDF_CANCELLED'});
 await assert.rejects(runPdfWorker('not-a-file',[],{signal:controller.signal}),{code:'PDF_CANCELLED'});
});
test('missing and invalid worker results never count as successful parsing',async t=>{
 for(const source of ["process.exit(0);","process.send({wrong:true},()=>process.exit(0));"]){
  const worker=await fixture(t,source);await assert.rejects(runPdfWorker(worker,[],{timeoutMs:5000}));
 }
});
