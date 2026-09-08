import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import net from 'node:net';
import {initialize} from '../src/config.mjs';
const cli=resolve('src/cli.mjs');
async function fixture(t){
 const home=await mkdtemp(join(tmpdir(),'relay-startup-'));t.after(()=>rm(home,{recursive:true,force:true}));await initialize(home);
 const env={...process.env,M365_RELAY_HOME:home,M365_RELAY_CODE:process.execPath,NODE_OPTIONS:'',NODE_PATH:''};
 const run=(...args)=>spawnSync(process.execPath,[cli,...args],{env,encoding:'utf8',windowsHide:true,timeout:15000});
 const setup=run('setup');assert.equal(setup.status,0,setup.stderr);
 const settings=join(home,'vscode-data','User','settings.json');
 const value=JSON.parse(await readFile(settings,'utf8'));value['editor.fontSize']=19;await writeFile(settings,JSON.stringify(value));
 const files=[settings,join(home,'vscode-data','User','chatLanguageModels.json'),join(home,'token.txt')];
 const before=await Promise.all(files.map(p=>readFile(p,'utf8')));
 const unchanged=async()=>assert.deepEqual(await Promise.all(files.map(p=>readFile(p,'utf8'))),before);
 return {home,run,unchanged};
}
test('duplicate Run leaves profile and credentials unchanged', {skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t);await mkdir(join(f.home,'bridge.lock'));
 await writeFile(join(f.home,'bridge.lock','owner.json'),JSON.stringify({pid:process.pid,started:new Date().toISOString()}));
 const result=f.run('run');assert.equal(result.status,1);assert.match(result.stderr,/already_running/);await f.unchanged();
 assert.equal(JSON.parse(await readFile(join(f.home,'bridge.lock','owner.json'),'utf8')).pid,process.pid);
});
test('occupied port stops before profile changes and releases acquired lock', {skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t),server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const path=join(f.home,'settings.json'),settings=JSON.parse(await readFile(path,'utf8'));settings.port=server.address().port;settings.cdpPort=settings.port===9333?9334:9333;await writeFile(path,JSON.stringify(settings));
 const result=f.run('run');assert.equal(result.status,1);assert.match(result.stderr,/bridge_port_in_use/);await f.unchanged();
 await assert.rejects(lstat(join(f.home,'bridge.lock')),{code:'ENOENT'});
 assert(server.listening);
});

test('setup failure after port reservation frees the lock and port', {skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t),probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const path=join(f.home,'settings.json'),settings=JSON.parse(await readFile(path,'utf8'));settings.port=port;settings.cdpPort=port===9333?9334:9333;await writeFile(path,JSON.stringify(settings));
 const result=f.run('run',join(f.home,'missing-workspace'));assert.equal(result.status,1);assert.match(result.stderr,/workspace_not_found/);await f.unchanged();
 await assert.rejects(lstat(join(f.home,'bridge.lock')),{code:'ENOENT'});
 const next=net.createServer();await new Promise((r,j)=>{next.once('error',j);next.listen(port,'127.0.0.1',r);});await new Promise(r=>next.close(r));
});
