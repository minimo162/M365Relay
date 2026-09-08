import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publishPdfOutput} from '../src/pdf-output.mjs';
test('PDF publication preserves existing files and cleans incomplete staging on cancellation',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'relay-pdf-output-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const output=join(dir,'output.json');await writeFile(output,'original');
 await assert.rejects(publishPdfOutput(output,'new'),{code:'EEXIST'});
 assert.equal(await readFile(output,'utf8'),'original');assert.deepEqual(await readdir(dir),['output.json']);
 await assert.rejects(publishPdfOutput(join(dir,'cancelled.json'),'partial',AbortSignal.abort()),{code:'PDF_CANCELLED'});
 assert.deepEqual(await readdir(dir),['output.json']);
 const complete=join(dir,'complete.json');await publishPdfOutput(complete,'{"complete":true}\n');
 assert.equal(await readFile(complete,'utf8'),'{"complete":true}\n');
 assert.deepEqual((await readdir(dir)).sort(),['complete.json','output.json']);
});
