import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {launchDesktop,observeDesktopWindow,desktopLaunchMessage} from '../src/desktop.mjs';
const plan={executable:'C:/fixture/Code.exe',userDataDir:'C:/fixture/profile',workspace:'C:/fixture/workspace'};
function fixture(){const child=new EventEmitter();child.pid=123;child.unref=()=>{child.unreferenced=true;};child.kill=()=>{throw Error('Must not kill VS Code');};return {child,spawnProcess:()=>{queueMicrotask(()=>child.emit('spawn'));return child;}};}
test('spawn is not a successful window receipt and a later failure is observed',async()=>{
 const f=fixture();let observing,signal;const started=new Promise(r=>observing=r);
 const receipt=launchDesktop(plan,{spawnProcess:f.spawnProcess,observeWindow:(_plan,pid,s)=>{assert.equal(pid,123);signal=s;observing();return new Promise(()=>{});}});
 await started;f.child.emit('exit',1,null);assert.deepEqual(await receipt,{status:'failed',exitCode:1});assert(signal.aborted);assert(f.child.unreferenced);assert.equal(f.child.listenerCount('exit'),0);
});
test('zero exit is an acknowledged request, not a claim that a window exists',async()=>{
 const f=fixture();const receipt=launchDesktop(plan,{spawnProcess:f.spawnProcess,observeWindow:()=>{queueMicrotask(()=>f.child.emit('exit',0,null));return new Promise(()=>{});}});
 assert.deepEqual(await receipt,{status:'handoff',exitCode:0});assert.doesNotMatch(desktopLaunchMessage(await receipt),/開きました|確認しました/);
});
test('window observation returns without waiting for the long-lived Code process to exit',async()=>{
 const f=fixture();const receipt=await launchDesktop(plan,{spawnProcess:f.spawnProcess,observeWindow:async()=>({status:'window'})});assert.deepEqual(receipt,{status:'window'});assert(f.child.unreferenced);
});
test('inspection failures remain unconfirmed and do not expose raw errors',async()=>{
 const f=fixture();const receipt=await launchDesktop(plan,{spawnProcess:f.spawnProcess,startupTimeoutMs:10,observeWindow:async()=>{throw Error('PRIVATE');}});assert.deepEqual(receipt,{status:'unconfirmed'});assert(!desktopLaunchMessage(receipt).includes('PRIVATE'));assert(!desktopLaunchMessage({status:'failed',exitCode:'PRIVATE'}).includes('PRIVATE'));
});
test('the observer uses only fixed script arguments and accepts only the exact result',async()=>{
 for(const stdout of ['window_ready','window_ready\nPRIVATE']){
  let options;const receipt=await observeDesktopWindow(plan,123,new AbortController().signal,{platform:'win32',execute:(exe,args,opts,done)=>{options=opts;assert(exe.endsWith('powershell.exe'));assert(args.includes('123'));assert.equal(args.at(-1),plan.executable);done(null,stdout);}});
  assert.equal(options.windowsHide,true);assert.equal(options.maxBuffer,4096);assert.equal(receipt.status,stdout==='window_ready'?'window':'unconfirmed');
 }
});

test('an unavailable observer does not misclassify a later normal handoff',async()=>{
 const f=fixture();const receipt=launchDesktop(plan,{spawnProcess:f.spawnProcess,startupTimeoutMs:1000,observeWindow:async()=>{setImmediate(()=>f.child.emit('exit',0,null));return {status:'unconfirmed'};}});assert.deepEqual(await receipt,{status:'handoff',exitCode:0});
});
