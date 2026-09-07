import { mkdir, readFile, writeFile, rename, unlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { uptime } from 'node:os';
import { createHmac, randomUUID } from 'node:crypto';
import { strictJson, canonical, isObject } from './json.mjs';
import { assert, BridgeError, abortReason } from './errors.mjs';
export class SerialQueue {
  constructor(maxQueue=4) { this.maxQueue=maxQueue; this.active=false; this.waiters=[]; }
  async acquire(signal) {
    abortReason(signal);
    if(!this.active) { this.active=true; return ()=>this.release(); }
    assert(this.waiters.length<this.maxQueue,'bridge_busy','処理待ちが上限に達しています。別の要求が完了してから開始してください。',409);
    await new Promise((resolve,reject)=>{
      const waiter={resolve, reject, signal};
      waiter.abort=()=>{ const i=this.waiters.indexOf(waiter); if(i>=0)this.waiters.splice(i,1); reject(signal.reason); };
      signal?.addEventListener('abort',waiter.abort,{once:true}); this.waiters.push(waiter);
    });
    return ()=>this.release();
  }
  release() {
    const next=this.waiters.shift();
    if(!next) {this.active=false;return;}
    next.signal?.removeEventListener('abort',next.abort); next.resolve();
  }
}
/** Records only keyed request fingerprints, IDs and transport state, never prompts/results. */
export class Ledger {
  constructor(home, key) {this.path=join(home,'requests.json');this.key=key;this.records={};}
  async load() {
    try { const r=strictJson(await readFile(this.path,'utf8'),{maxBytes:8*1024*1024}); assert(isObject(r),'invalid_ledger','要求台帳が不正です。'); this.records=r; }
    catch(e) { if(e.code!=='ENOENT')throw e; }
  }
  fingerprint(payload) {
    const {request_id, ...semantic}=payload;
    return createHmac('sha256',this.key).update(canonical(semantic)).digest('hex');
  }
  async flush() {
    const temp=`${this.path}.${randomUUID()}.tmp`;
    await writeFile(temp,JSON.stringify(this.records,null,2),{mode:0o600});
    try { await rename(temp,this.path); } finally { await unlink(temp).catch(()=>{}); }
  }
  async reserve(req) {
    const hash=this.fingerprint(req.payload), old=this.records[hash];
    if(old && old.status!=='not_sent') throw new BridgeError('duplicate_request',
      '同じ要求は処理済み、処理中、または結果不明です。自動で再送しません。再試行が必要な場合はチャットに明示的な追加指示を書いてください。',409,
      {prior_request_id:old.id,transport_status:old.status});
    assert(Object.keys(this.records).length < 10000 || old,'ledger_full','要求台帳が上限です。停止後に管理者が保管・初期化してください。',409);
    this.records[hash]={id:req.requestId,status:'reserved',at:new Date().toISOString()}; await this.flush(); return hash;
  }
  async set(hash,status) { this.records[hash]={...this.records[hash],status,at:new Date().toISOString()}; await this.flush(); }
}
function bootStartedAtMs(now=Date.now(),up=uptime()) {
  return now-Math.max(0,up)*1000;
}
function lockPredatesBoot(owner,{now=Date.now(),up=uptime()}={}) {
  const started=Date.parse(owner?.started);
  if(!Number.isFinite(started))return false;
  return started < bootStartedAtMs(now,up)-1000;
}
async function readLockOwner(path) {
  let owner; try{owner=strictJson(await readFile(join(path,'owner.json'),'utf8'));}
  catch{throw new BridgeError('lock_unverifiable','ロック所有者を確認できません。手動でプロセスを確認してください。');}
  assert(Number.isInteger(owner.pid) && owner.pid>0,'lock_unverifiable','ロック所有者が不正です。');
  assert(Number.isFinite(Date.parse(owner.started)),'lock_unverifiable','ロック作成時刻が不正です。');
  return owner;
}
async function removeStaleLockAfterReboot(path) {
  const owner=await readLockOwner(path);
  if(!lockPredatesBoot(owner))return false;
  await rm(path,{recursive:true,force:true});
  return true;
}
export async function acquireProcessLock(home) {
  const path=join(home,'bridge.lock');
  for(let attempt=0;attempt<2;attempt++) {
    try { await mkdir(path); }
    catch(e) {
      if(e.code!=='EEXIST')throw e;
      if(attempt===0 && await removeStaleLockAfterReboot(path))continue;
      throw new BridgeError('already_running','M365Relayの起動ロックがあります。動作中ならその起動ウィンドウを使用してください。異常終了後は配布フォルダーのRecover.cmdを開き、復旧に成功したらRun.cmdを開き直してください。',409);
    }
    await writeFile(join(path,'owner.json'),JSON.stringify({pid:process.pid,started:new Date().toISOString()}),{mode:0o600});
    return ()=>rm(path,{recursive:true,force:true});
  }
  throw new BridgeError('already_running','起動ロックを取得できません。',409);
}
export async function recoverProcessLock(home) {
  const path=join(home,'bridge.lock');
  const owner=await readLockOwner(path);
  if(lockPredatesBoot(owner)) { await rm(path,{recursive:true,force:true}); return; }
  let running=true; try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')running=false;}
  assert(!running,'process_alive','同じPIDのプロセスが存在するためロックを削除しません。',409);
  await rm(path,{recursive:true,force:true});
}
export { lockPredatesBoot };
