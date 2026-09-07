import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig,initialize } from '../src/config.mjs';
import { acquireProcessLock,recoverProcessLock,lockPredatesBoot } from '../src/state.mjs';
async function temp(t){const h=await mkdtemp(join(tmpdir(),'bridge-config-'));t.after(()=>rm(h,{recursive:true,force:true}));return h;}
test('init is idempotent and does not overwrite the local token',async t=>{
  const home=await temp(t);await initialize(home);const token=await readFile(join(home,'token.txt'),'utf8');await initialize(home);assert.equal(await readFile(join(home,'token.txt'),'utf8'),token);
  assert.match(token.trim(),/^[a-f0-9]{64}$/);const c=await loadConfig(home);assert.equal(c.origin,'https://m365.cloud.microsoft');
});
test('arbitrary browser destination and invalid ports rejected',async t=>{
  const home=await temp(t);await initialize(home);const path=join(home,'settings.json');const base=JSON.parse(await readFile(path,'utf8'));
  await writeFile(path,JSON.stringify({...base,copilotUrl:'https://evil.example/chat/'}));await assert.rejects(loadConfig(home),{code:'untrusted_url'});
  await writeFile(path,JSON.stringify({...base,port:0}));await assert.rejects(loadConfig(home),{code:'invalid_port'});
});
test('invalid user configuration is not silently replaced with defaults',async t=>{
  const home=await temp(t);await initialize(home);await writeFile(join(home,'settings.json'),'{');await assert.rejects(loadConfig(home),{code:'invalid_json'});
});
test('second process lock acquisition fails without deleting live lock',async t=>{
  const home=await temp(t);const unlock=await acquireProcessLock(home);await assert.rejects(acquireProcessLock(home),{code:'already_running'});
  await assert.rejects(recoverProcessLock(home),{code:'process_alive'});await unlock();const unlock2=await acquireProcessLock(home);await unlock2();
});
test('lock from a previous OS boot is stale even if its PID may have been reused',()=>{
  const now=1_800_000_000_000,up=120;
  assert.equal(lockPredatesBoot({pid:123,started:new Date(now-3600_000).toISOString()},{now,up}),true);
  assert.equal(lockPredatesBoot({pid:123,started:new Date(now-60_000).toISOString()},{now,up}),false);
});
test('current-boot live lock still blocks a second bridge',async t=>{
  const home=await temp(t);const unlock=await acquireProcessLock(home);
  await assert.rejects(acquireProcessLock(home),{code:'already_running'});await unlock();
});
