import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRequest} from '../src/protocol.mjs';
import {M365Backend} from '../src/m365.mjs';
import {readFile} from 'node:fs/promises';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq1sAAAAASUVORK5CYII=';
const part={type:'image_url',image_url:{url:'data:image/png;base64,'+png}};
const body={model:'m365-copilot-ui',messages:[{role:'user',content:[{type:'text',text:'inspect'},part]}]};
test('image bytes stay out of prompt while message position and digest are preserved',()=>{
 const r=prepareRequest(body,'template',{allowImages:true});
 assert.equal(r.images.length,1);assert.equal(r.images[0].messageIndex,0);assert.equal(r.images[0].partIndex,1);
 assert.equal(r.images[0].width,1);assert.equal(r.images[0].height,1);
 assert(!r.prompt.includes(png));assert(r.prompt.includes(r.images[0].sha256));
 assert.equal(r.payload.messages[0].content[1].id,r.images[0].id);
});
test('image input is disabled until an attachment transport is verified',async()=>{
 assert.throws(()=>prepareRequest(body,'template'),{code:'text_only'});
 let connected=false;
 const backend=new M365Backend({},{connect:async()=>{connected=true;}});
 await assert.rejects(backend.complete(prepareRequest(body,'x',{allowImages:true}),{}),{code:'image_transport_unavailable'});
 assert.equal(connected,false);
});
test('external URLs, mismatched types, invalid data, forbidden roles and too many images are rejected',()=>{
 const make=(p,role='user')=>prepareRequest({...body,messages:[{role,content:[p]}]},'x',{allowImages:true});
 for(const url of ['https://example.com/a.png','file:///C:/secret.png','data:image/gif;base64,R0lG','data:image/jpeg;base64,'+png,'data:image/png;base64,abcd'])assert.throws(()=>make({type:'image_url',image_url:{url}}));
 assert.throws(()=>make(part,'system'),{code:'invalid_image_role'});
 assert.throws(()=>prepareRequest({...body,messages:[{role:'user',content:Array(5).fill(part)}]},'x',{allowImages:true}),{code:'image_limit'});
});
test('actual JPEG and PNG keep distinct message positions, dimensions and attachment names',async()=>{
 const jpeg=await readFile(new URL('./fixtures/vision-jpeg.jpg',import.meta.url));
 const jpgPart={type:'image_url',image_url:{url:'data:image/jpeg;base64,'+jpeg.toString('base64')}};
 const req=prepareRequest({...body,messages:[{role:'user',content:[part]},{role:'user',content:[{type:'text',text:'second'},jpgPart]}]},'x',{allowImages:true});
 assert.deepEqual(req.images.map(i=>[i.mime,i.width,i.height,i.messageIndex,i.partIndex]),[['image/png',1,1,0,0],['image/jpeg',700,220,1,1]]);
 assert.notEqual(req.images[0].fileName,req.images[1].fileName);
 assert(req.images[1].fileName.endsWith('.jpg'));
 const broken={type:'image_url',image_url:{url:'data:image/jpeg;base64,'+jpeg.subarray(0,25).toString('base64')}};
 assert.throws(()=>prepareRequest({...body,messages:[{role:'user',content:[broken]}]},'x',{allowImages:true}),{code:'invalid_image'});
});
