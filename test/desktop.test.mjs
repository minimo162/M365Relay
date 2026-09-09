import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,realpath,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {prepareDesktop,findVSCode,launchDesktop} from '../src/desktop.mjs';
async function fixture(t){const home=await mkdtemp(join(tmpdir(),'relay-desktop-'));t.after(()=>rm(home,{recursive:true,force:true}));return {home,port:8731,token:'a'.repeat(64)};}

test('legacy profiles are not opted into a new extensions directory',async t=>{
 const c=await fixture(t);await mkdir(join(c.home,'vscode-data/User'),{recursive:true});
 const path=join(c.home,'vscode-data/User/settings.json');await writeFile(path,JSON.stringify({'extensions.autoUpdate':false}));
 const plan=await prepareDesktop(c);assert.equal(plan.extensionsDir,undefined);
 const settings=JSON.parse(await readFile(path,'utf8'));
 assert.equal(settings['m365Relay.initializeFirstRun'],undefined);assert.equal(settings['extensions.autoUpdate'],false);
});

test('first-run setup creates an isolated usable model without modifying a normal profile',async t=>{
 const c=await fixture(t);const normal=join(c.home,'normal-profile.json');await writeFile(normal,'USER SETTINGS');
 const plan=await prepareDesktop(c,{executable:'Code.exe'});
 assert.equal(plan.extensionsDir,join(c.home,'vscode-extensions'));
 assert.equal(plan.userDataDir,await realpath(join(c.home,'vscode-data')));
 const groups=JSON.parse(await readFile(join(plan.userDataDir,'User','chatLanguageModels.json'),'utf8'));
 const m=groups[0].models[0];assert.equal(m.requestHeaders.Authorization,'Bearer '+c.token);
 assert.equal(m.maxInputTokens,256000);assert.equal(m.maxOutputTokens,8000);
 assert.equal(m.vision,true);
 assert.equal(m.url,'http://127.0.0.1:8731/v1/chat/completions');assert.equal(groups[0].apiKey,undefined);
 const settings=JSON.parse(await readFile(join(plan.userDataDir,'User','settings.json'),'utf8'));
 assert.equal(settings['m365Relay.initializeFirstRun'],true);
 assert.equal(settings['workbench.editor.useModal'],'off');
 assert.equal(settings['chat.byokUtilityModelDefault'],'none');
 assert.equal(settings['chat.utilityModel'],'customendpoint/m365-copilot-ui');
 assert.equal(settings['editor.fontSize'],16);assert.equal(settings['chat.fontSize'],16);
 assert.equal(settings['chat.editor.fontSize'],16);assert.equal(settings['window.zoomLevel'],1);
 assert.equal(settings['chat.permissions.default'],'autopilot');
 assert.equal(settings['m365Relay.statusUrl'],'http://127.0.0.1:8731/health');
 assert.equal(settings['workbench.startupEditor'],'none');
 assert.equal(settings['workbench.secondarySideBar.defaultVisibility'],'maximized');
 assert.equal(settings['chat.viewSessions.enabled'],true);
 assert.equal(settings['chat.viewSessions.orientation'],'sideBySide');
 assert.equal(settings['workbench.sideBar.location'],'left');
 assert.equal(settings['security.workspace.trust.enabled'],false);
 assert.equal(settings['terminal.integrated.env.windows'].M365_RELAY_NODE,await realpath(process.execPath));
 assert.equal(await readFile(normal,'utf8'),'USER SETTINGS');
 assert.match(await readFile(join(plan.workspace,'はじめに.md'),'utf8'),/サインイン/);
});

test('repeat setup reapplies display settings and preserves unrelated preferences and workspace files',async t=>{
 const c=await fixture(t),p=await prepareDesktop(c);const models=join(p.userDataDir,'User','chatLanguageModels.json');
 const groups=JSON.parse(await readFile(models,'utf8'));groups.push({name:'User custom model',vendor:'other',models:[]});await writeFile(models,JSON.stringify(groups));
 await writeFile(join(p.userDataDir,'User','settings.json'),JSON.stringify({'editor.fontSize':18,'window.zoomLevel':0,'editor.wordWrap':'on','chat.byokUtilityModelDefault':'none','security.workspace.trust.enabled':true,'chat.tools.global.autoApprove':false}));
 await writeFile(join(p.workspace,'はじめに.md'),'user-edited guide');
 await prepareDesktop({...c,port:8744,token:'b'.repeat(64)});
 const updated=JSON.parse(await readFile(models,'utf8'));assert(updated.some(g=>g.name==='User custom model'));
 const m=updated.find(g=>g.name==='M365Relay').models[0];assert.equal(m.url,'http://127.0.0.1:8744/v1/chat/completions');assert.equal(m.requestHeaders.Authorization,'Bearer '+'b'.repeat(64));
 assert.equal(await readFile(join(p.workspace,'はじめに.md'),'utf8'),'user-edited guide');
 const settings=JSON.parse(await readFile(join(p.userDataDir,'User','settings.json'),'utf8'));assert.equal(settings['editor.fontSize'],16);assert.equal(settings['window.zoomLevel'],1);assert.equal(settings['editor.wordWrap'],'on');assert.equal(settings['chat.byokUtilityModelDefault'],'none');
 const bytes=await readFile(models,'utf8');await prepareDesktop({...c,port:8744,token:'b'.repeat(64)});assert.equal(await readFile(models,'utf8'),bytes);
 assert.equal(settings['security.workspace.trust.enabled'],false);
 assert.equal(settings['chat.tools.global.autoApprove'],false);
});

test('malformed or conflicting model configuration is preserved and rejected',async t=>{
 const c=await fixture(t),p=await prepareDesktop(c);const path=join(p.userDataDir,'User','chatLanguageModels.json');
 for(const text of ['{',JSON.stringify([{name:'M365Relay',vendor:'unrelated',models:[]}])]){
  await writeFile(path,text);await assert.rejects(prepareDesktop(c));assert.equal(await readFile(path,'utf8'),text);
 }
});

test('workspace arguments are validated and launching never interprets them through a shell',async t=>{
 const c=await fixture(t);await assert.rejects(prepareDesktop(c,{workspace:join(c.home,'missing')}),{code:'workspace_not_found'});
 const folder=join(c.home,'space & quote-test');await mkdir(folder);
 const plan=await prepareDesktop(c,{workspace:folder,executable:'Code.exe'});let captured;
 await launchDesktop(plan,{observeWindow:async()=>({status:'window'}),spawnProcess:(exe,args,options)=>{
  captured={exe,args,options};const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;
 }});
 assert.deepEqual(captured.args,['--user-data-dir',plan.userDataDir,'--extensions-dir',plan.extensionsDir,'--skip-welcome','--new-window',await realpath(folder)]);
 assert.equal(captured.options.shell,false);assert.equal(captured.options.env.ELECTRON_RUN_AS_NODE,undefined);
 assert.equal(captured.options.env.M365_RELAY_WORKSPACE_STATE,plan.workspaceStateFile);
 assert(!JSON.stringify(captured.args).includes(c.token));
});

test('reuses the dedicated last workspace and refuses a removed remembered folder',async t=>{
 const c=await fixture(t),remembered=join(c.home,'remembered'),explicit=join(c.home,'explicit');
 await mkdir(remembered);await writeFile(join(c.home,'workspace-state.json'),JSON.stringify({version:1,path:remembered,updated_at:new Date().toISOString()}));
 const plan=await prepareDesktop(c,{executable:'Code.exe'});
 assert.equal(plan.workspace,await realpath(remembered));
 await mkdir(explicit);const override=await prepareDesktop(c,{executable:'Code.exe',workspace:explicit});
 assert.equal(override.workspace,await realpath(explicit));
 await rm(remembered,{recursive:true});
 await assert.rejects(prepareDesktop(c,{executable:'Code.exe'}),{code:'workspace_not_found'});
});

test('VS Code discovery reports missing prerequisite and supports explicit portable path',async()=>{
 await assert.rejects(findVSCode({env:{},exists:async()=>{throw new Error('absent');}}),{code:'vscode_not_found'});
 const path=resolve('portable/Code.exe');assert.equal(await findVSCode({env:{M365_RELAY_CODE:path},exists:async p=>assert.equal(p,path)}),path);
});

test('old generated utility default migrates without changing a customized selection',async t=>{
 const c=await fixture(t),p=await prepareDesktop(c);const settingsPath=join(p.userDataDir,'User','settings.json');
 await writeFile(settingsPath,JSON.stringify({'chat.byokUtilityModelDefault':'mainAgent'}));
 await prepareDesktop(c);assert.equal(JSON.parse(await readFile(settingsPath,'utf8'))['chat.byokUtilityModelDefault'],'none');
 await writeFile(settingsPath,JSON.stringify({'chat.byokUtilityModelDefault':'mainAgent','chat.utilityModel':'customendpoint/user-model'}));
 await prepareDesktop(c);const s=JSON.parse(await readFile(settingsPath,'utf8'));assert.equal(s['chat.byokUtilityModelDefault'],'mainAgent');assert.equal(s['chat.utilityModel'],'customendpoint/user-model');
});

test('desktop resolves workspace links without adding execution approvals or path allowlists',async t=>{
 const c=await fixture(t),target=join(c.home,'actual'),link=join(c.home,'linked');
 await mkdir(target);await writeFile(join(target,'sample.txt'),'preserve');
 await symlink(target,link,process.platform==='win32'?'junction':'dir');
 const plan=await prepareDesktop(c,{workspace:link});assert.equal(plan.workspace,await realpath(target));
 assert.equal(await readFile(join(plan.workspace,'sample.txt'),'utf8'),'preserve');
 const settings=JSON.parse(await readFile(join(plan.userDataDir,'User','settings.json'),'utf8'));
 assert.equal(settings['security.workspace.trust.enabled'],false);
 assert(!Object.keys(settings).filter(k=>k!=='security.workspace.trust.enabled').some(k=>/trust|allow|approve|access/i.test(k)));
});

test('unresolvable workspace fails rather than opening a guessed location',async t=>{
 const c=await fixture(t);
 await assert.rejects(prepareDesktop(c,{resolveRealPath:async()=>{throw new Error('denied');}}),{code:'workspace_resolution_failed'});
});

test('profile launch path is physical so restarts keep the same history directory',async t=>{
 const c=await fixture(t),actual=join(c.home,'actual-profile'),alias=join(c.home,'vscode-data');
 await mkdir(join(actual,'User'),{recursive:true});
 await writeFile(join(actual,'User','history-sentinel'),'keep-existing-history');
 await symlink(actual,alias,process.platform==='win32'?'junction':'dir');
 const plan=await prepareDesktop(c,{executable:'Code.exe'});
 assert.equal(plan.userDataDir,await realpath(actual));
 assert.equal(await readFile(join(actual,'User','history-sentinel'),'utf8'),'keep-existing-history');
 let captured;
 await launchDesktop(plan,{observeWindow:async()=>({status:'window'}),spawnProcess:(exe,args)=>{
  captured=args;const child=new EventEmitter();child.unref=()=>{};
  queueMicrotask(()=>child.emit('spawn'));return child;
 }});
 assert.equal(captured[captured.indexOf('--user-data-dir')+1],await realpath(actual));
});

test('bundled Python is exposed without changing global PATH or other terminal preferences',async t=>{
 const c=await fixture(t),runtime=join(c.home,'runtime');
 await mkdir(join(runtime,'python'),{recursive:true});
 await writeFile(join(runtime,'node.exe'),'runtime fixture');
 await writeFile(join(runtime,'python','python.exe'),'python fixture');
 const plan=await prepareDesktop(c,{runtimeExecutable:join(runtime,'node.exe'),executable:'Code.exe'});
 const settings=JSON.parse(await readFile(join(plan.userDataDir,'User','settings.json'),'utf8'));
 const env=settings['terminal.integrated.env.windows'];
 assert.match(env.M365_RELAY_APP,/M365Relay[\\/]*$/i);
 assert.equal(env.M365_RELAY_PYTHON,await realpath(join(runtime,'python','python.exe')));
 assert.equal(env.M365_RELAY_OFFICECLI,undefined);assert.match(env.M365_RELAY_DOCUMENTS,/document_runtime.py$/);
 assert(!Object.keys(env).some(k=>k.toLowerCase()==='path'));
});
