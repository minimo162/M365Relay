import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installBootstrap,vscodeCliPath} from '../src/bootstrap.mjs';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'relay-bootstrap-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const code=join(root,'Code'),bundle=join(root,'bundle'),user=join(root,'user');
 for(const p of [join(code,'bin'),join(code,'build/resources/app/out'),bundle,user])await mkdir(p,{recursive:true});
 const executable=join(code,'Code.exe'),cli=join(code,'build/resources/app/out/cli.js');
 await writeFile(executable,'fixture');await writeFile(cli,'fixture');
 await writeFile(join(code,'bin/code.cmd'),'"%~dp0..\\Code.exe" "%~dp0..\\build\\resources\\app\\out\\cli.js" %*');
 const metadata={publisher:'m365relay',name:'first-run-model-setup',version:'0.1.0'};
 await writeFile(join(bundle,'package.json'),JSON.stringify(metadata));await writeFile(join(bundle,'extension.cjs'),'fixture bootstrap');await writeFile(join(bundle,'first-run-model-setup.vsix'),'fixture vsix');
 return {root,code,bundle,cli,metadata,plan:{executable,userDataDir:join(user,'vscode-data'),extensionsDir:join(user,'vscode-extensions')}};
}

test('installer uses the scoped CLI without a shell and skips an intact installed copy',async t=>{
 const f=await fixture(t);assert.equal(await vscodeCliPath(f.plan.executable),f.cli);let calls=0;
 const run=async(exe,args,options)=>{
  calls++;assert.equal(exe,f.plan.executable);assert.equal(args[0],f.cli);
  assert(args.includes(f.plan.extensionsDir));assert(args.includes(f.plan.userDataDir));assert(args.includes('--do-not-sync'));
  assert(!options.shell);assert.equal(options.env.ELECTRON_RUN_AS_NODE,'1');assert.equal(options.env.NODE_OPTIONS,'');
  const installed=join(f.plan.extensionsDir,'m365relay.first-run-model-setup-0.1.0');await mkdir(installed,{recursive:true});
  for(const name of ['package.json','extension.cjs'])await writeFile(join(installed,name),await readFile(join(f.bundle,name)));
 };
 await installBootstrap(f.plan,{bundleDir:f.bundle,run});await installBootstrap(f.plan,{bundleDir:f.bundle,run});assert.equal(calls,1);
 await installBootstrap({executable:f.plan.executable},{run:()=>assert.fail('legacy profile must not install')});
});

test('installer refuses an escaped CLI path and reports installation failure',async t=>{
 const f=await fixture(t);
 await assert.rejects(installBootstrap(f.plan,{bundleDir:f.bundle,run:async()=>{throw Error('fixture');}}),{code:'vscode_setup_failed'});
 const outside=join(f.root,'outside/resources/app/out');await mkdir(outside,{recursive:true});await writeFile(join(outside,'cli.js'),'fixture');
 await writeFile(join(f.code,'bin/code.cmd'),'"%~dp0..\\..\\outside\\resources\\app\\out\\cli.js"');
 await assert.rejects(vscodeCliPath(f.plan.executable),{code:'vscode_cli_unavailable'});
});
