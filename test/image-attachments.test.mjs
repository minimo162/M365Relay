import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {attachRequestImages} from '../src/image-attachments.mjs';
const images=[{fileName:'image-1-123456789abc.png',bytes:Buffer.from('test')}];
test('image upload is journaled once, reverified and cleaned locally',async t=>{
 const home=await mkdtemp(join(tmpdir(),'relay-image-test-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const events=[];let attached=false;
 const browser={async send(method){events.push(method);if(method==='Runtime.evaluate')return {result:{value:{attached:[attached],attachmentCount:attached?1:0,pending:false}}};if(method==='DOM.getDocument')return {root:{nodeId:1}};if(method==='DOM.querySelectorAll')return {nodeIds:[2]};if(method==='DOM.setFileInputFiles')attached=true;return {};}};
 const lease=await attachRequestImages({browser,sessionId:'s',config:{home,origin:'https://m365.cloud.microsoft',readyTimeoutMs:2000},images,onBeforeUpload:async()=>events.push('journal')});
 assert(events.indexOf('journal')<events.indexOf('DOM.setFileInputFiles'));
 assert.equal(events.filter(e=>e==='DOM.setFileInputFiles').length,1);
 await lease.verify();attached=false;
 await assert.rejects(lease.verify(),{code:'image_attachment_changed'});
 await lease.cleanup();assert.deepEqual(await readdir(join(home,'image-staging')),[]);
});
test('ambiguous input never uploads and clears staged files',async t=>{
 const home=await mkdtemp(join(tmpdir(),'relay-image-test-'));t.after(()=>rm(home,{recursive:true,force:true}));let journal=false;
 const browser={async send(method){if(method==='Runtime.evaluate')return {result:{value:{attached:[false],attachmentCount:0,pending:false}}};if(method==='DOM.getDocument')return {root:{nodeId:1}};if(method==='DOM.querySelectorAll')return {nodeIds:[2,3]};throw Error('Unexpected upload');}};
 await assert.rejects(attachRequestImages({browser,config:{home,origin:'https://m365.cloud.microsoft',readyTimeoutMs:10},images,onBeforeUpload:async()=>journal=true}),{code:'image_input_missing'});
 assert.equal(journal,false);assert.deepEqual(await readdir(join(home,'image-staging')),[]);
});

test('lost upload acknowledgement is never retried and local bytes are removed',async t=>{
 const home=await mkdtemp(join(tmpdir(),'relay-image-test-'));t.after(()=>rm(home,{recursive:true,force:true}));
 let uploads=0,journaled=false;
 const browser={async send(method){
  if(method==='Runtime.evaluate')return {result:{value:{attached:[false],attachmentCount:0,pending:false}}};
  if(method==='DOM.getDocument')return {root:{nodeId:1}};
  if(method==='DOM.querySelectorAll')return {nodeIds:[2]};
  if(method==='DOM.setFileInputFiles'){assert(journaled);uploads++;throw new Error('lost acknowledgement');}
  throw Error('Unexpected command');
 }};
 await assert.rejects(attachRequestImages({browser,config:{home,origin:'https://m365.cloud.microsoft',readyTimeoutMs:10},images,onBeforeUpload:async()=>journaled=true}));
 assert.equal(uploads,1);assert.deepEqual(await readdir(join(home,'image-staging')),[]);
});

test('generated TXT and image share a single journaled upload',async t=>{
 const home=await mkdtemp(join(tmpdir(),'relay-attachment-test-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const files=[{fileName:'relay-tools-123456789abc.txt',bytes:Buffer.from('protocol')},...images];
 let attached=false,uploads=0,journaled=false;
 const browser={async send(method,args){
  if(method==='Runtime.evaluate')return {result:{value:{attached:files.map(()=>attached),attachmentCount:attached?2:0,pending:false}}};
  if(method==='DOM.getDocument')return {root:{nodeId:1}};
  if(method==='DOM.querySelectorAll')return {nodeIds:[2]};
  if(method==='DOM.setFileInputFiles'){assert(journaled);assert.equal(args.files.length,2);uploads++;attached=true;}return {};
 }};
 const lease=await attachRequestImages({browser,config:{home,origin:'https://m365.cloud.microsoft',readyTimeoutMs:2000},images:files,onBeforeUpload:async()=>{journaled=true;}});
 assert.equal(uploads,1);await lease.verify();await lease.cleanup();assert.deepEqual(await readdir(join(home,'image-staging')),[]);
});
