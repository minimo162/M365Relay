import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {reserveBridgePort} from '../src/listen.mjs';

test('automatic port selection leaves the occupied listener working',async t=>{
 const occupied=createServer((req,res)=>res.end('original'));
 const next=createServer((req,res)=>res.end('relay'));
 t.after(()=>Promise.all([occupied,next].map(s=>new Promise(r=>s.close(r)))));
 const preferred=await reserveBridgePort(occupied,0);
 await assert.rejects(reserveBridgePort(next,preferred),{code:'bridge_port_in_use'});
 const actual=await reserveBridgePort(next,preferred,{allowFallback:true});
 assert.notEqual(actual,preferred);
 assert.equal(await (await fetch(`http://127.0.0.1:${preferred}`)).text(),'original');
 assert.equal(await (await fetch(`http://127.0.0.1:${actual}`)).text(),'relay');
 assert.equal(next.address().address,'127.0.0.1');
});
