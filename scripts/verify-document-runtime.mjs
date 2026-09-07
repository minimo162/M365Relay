import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [appArg,workArg]=process.argv.slice(2);
assert(appArg&&workArg,'Pass extracted application and test directory');
const app=resolve(appArg),work=resolve(workArg);
const env={...process.env,NODE_OPTIONS:'',NODE_PATH:'',OFFICECLI_SKIP_UPDATE:'1',OFFICECLI_NO_AUTO_RESIDENT:'1'};
const run=(exe,args)=>execFileSync(exe,args,{encoding:'utf8',env,timeout:20000,windowsHide:true});

// A minimal, deterministic PDF with a correct xref, without fixture libraries.
const content='BT /F1 12 Tf 40 100 Td (RUNTIME-CHECK 17.50) Tj ET';
const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
 '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
 '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
let pdf='%PDF-1.4\n',offsets=[0];
for(const [i,body] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${body}\nendobj\n`;}
const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const input=join(work,'document-runtime.pdf'),output=join(work,'document-runtime.json');
await writeFile(input,pdf,{flag:'wx'});
const original=createHash('sha256').update(await readFile(input)).digest('hex');
const pdfArgs=[join(app,'src','pdf-cli.mjs'),input,output,'1'];
run(process.execPath,pdfArgs);
const result=JSON.parse(await readFile(output,'utf8'));
assert.equal(result.totalPages,1);assert.equal(result.ocrEnabled,false);
assert.equal(result.selectionComplete,true);assert.deepEqual(result.pagesWithoutText,[]);
assert(result.pages[0].textItems.some(i=>i.text.includes('RUNTIME-CHECK')&&Number.isFinite(i.x)&&Number.isFinite(i.y)));
assert(result.markdown.includes('17.50'));
const outputBytes=await readFile(output);
assert.throws(()=>run(process.execPath,pdfArgs));
assert.deepEqual(await readFile(output),outputBytes);
assert.equal(createHash('sha256').update(await readFile(input)).digest('hex'),original);
const blankInput=join(work,'blank.pdf'),blankOutput=join(work,'blank.json');
await writeFile(blankInput,pdf.replace('RUNTIME-CHECK 17.50',' '.repeat('RUNTIME-CHECK 17.50'.length)),{flag:'wx'});
run(process.execPath,[pdfArgs[0],blankInput,blankOutput]);
const blank=JSON.parse(await readFile(blankOutput,'utf8'));
assert.equal(blank.selectionComplete,true);assert.deepEqual(blank.pagesWithoutText,[1]);
assert(blank.warnings.some(w=>w.code==='no_text_extracted'));
const outside=join(work,'outside.json');
assert.throws(()=>run(process.execPath,[pdfArgs[0],input,outside,'2']));
await assert.rejects(readFile(outside),{code:'ENOENT'});

const office=join(app,'runtime','officecli','officecli.exe'),sheet=join(work,'document-runtime.xlsx');
assert.equal(run(office,['--version']).trim(),'1.0.148');
run(office,['create',sheet]);
run(office,['set',sheet,'/Sheet1/A1','--prop','value=1.5']);
run(office,['set',sheet,'/Sheet1/A2','--prop','value=2']);
run(office,['set',sheet,'/Sheet1/A3','--prop','formula=SUM(A1:A2)']);
const cell=JSON.parse(run(office,['get',sheet,'/Sheet1/A3','--json']));
assert.equal(cell.data.results[0].format.computedValue,'3.5');
const checked=JSON.parse(run(office,['validate',sheet,'--json']));
assert.equal(checked.success,true);assert.equal(checked.data.count,0);
console.log('PASS bundled PDF text/coordinates/output protection and Office formula/readback/schema');
