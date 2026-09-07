import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,realpath,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {prepareDesktop,findVSCode,launchDesktop} from '../src/desktop.mjs';
async function fixture(t){const home=await mkdtemp(join(tmpdir(),'relay-desktop-'));t.after(()=>rm(home,{recursive:true,force:true}));return {home,port:8731,token:'a'.repeat(64)};}

test('first-run setup creates an isolated usable model without modifying a normal profile',async t=>{
 const c=await fixture(t);const normal=join(c.home,'normal-profile.json');await writeFile(normal,'USER SETTINGS');
 const plan=await prepareDesktop(c,{executable:'Code.exe'});
 assert.equal(plan.userDataDir,join(c.home,'vscode-data'));
 const groups=JSON.parse(await readFile(join(plan.userDataDir,'User','chatLanguageModels.json'),'utf8'));
 const m=groups[0].models[0];assert.equal(m.requestHeaders.Authorization,'Bearer '+c.token);
 assert.equal(m.maxInputTokens,28000);assert.equal(m.maxOutputTokens,8000);
 assert.equal(m.url,'http://127.0.0.1:8731/v1/chat/completions');assert.equal(groups[0].apiKey,undefined);
 const settings=JSON.parse(await readFile(join(plan.userDataDir,'User','settings.json'),'utf8'));
 assert.equal(settings['chat.byokUtilityModelDefault'],'none');
 assert.equal(settings['chat.utilityModel'],'customendpoint/m365-copilot-ui');
 assert.equal(settings['editor.fontSize'],16);assert.equal(settings['chat.fontSize'],16);
 assert.equal(settings['chat.editor.fontSize'],16);assert.equal(settings['window.zoomLevel'],1);
 assert.equal(await readFile(normal,'utf8'),'USER SETTINGS');
 assert.match(await readFile(join(plan.workspace,'はじめに.md'),'utf8'),/サインイン/);
});

test('repeat setup reapplies display settings and preserves unrelated preferences and workspace files',async t=>{
 const c=await fixture(t),p=await prepareDesktop(c);const models=join(p.userDataDir,'User','chatLanguageModels.json');
 const groups=JSON.parse(await readFile(models,'utf8'));groups.push({name:'User custom model',vendor:'other',models:[]});await writeFile(models,JSON.stringify(groups));
 await writeFile(join(p.userDataDir,'User','settings.json'),JSON.stringify({'editor.fontSize':18,'window.zoomLevel':0,'editor.wordWrap':'on','chat.byokUtilityModelDefault':'none'}));
 await writeFile(join(p.workspace,'はじめに.md'),'user-edited guide');
 await prepareDesktop({...c,port:8744,token:'b'.repeat(64)});
 const updated=JSON.parse(await readFile(models,'utf8'));assert(updated.some(g=>g.name==='User custom model'));
 const m=updated.find(g=>g.name==='M365Relay').models[0];assert.equal(m.url,'http://127.0.0.1:8744/v1/chat/completions');assert.equal(m.requestHeaders.Authorization,'Bearer '+'b'.repeat(64));
 assert.equal(await readFile(join(p.workspace,'はじめに.md'),'utf8'),'user-edited guide');
 const settings=JSON.parse(await readFile(join(p.userDataDir,'User','settings.json'),'utf8'));assert.equal(settings['editor.fontSize'],16);assert.equal(settings['window.zoomLevel'],1);assert.equal(settings['editor.wordWrap'],'on');assert.equal(settings['chat.byokUtilityModelDefault'],'none');
 const bytes=await readFile(models,'utf8');await prepareDesktop({...c,port:8744,token:'b'.repeat(64)});assert.equal(await readFile(models,'utf8'),bytes);
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
 await launchDesktop(plan,{spawnProcess:(exe,args,options)=>{
  captured={exe,args,options};const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;
 }});
 assert.deepEqual(captured.args,['--user-data-dir',plan.userDataDir,'--new-window',await realpath(folder)]);
 assert.equal(captured.options.shell,false);assert.equal(captured.options.env.ELECTRON_RUN_AS_NODE,undefined);
 assert(!JSON.stringify(captured.args).includes(c.token));
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

test('desktop opens the real directory of a workspace link without changing access settings',async t=>{
 const c=await fixture(t),target=join(c.home,'actual'),link=join(c.home,'linked');
 await mkdir(target);await writeFile(join(target,'sample.txt'),'preserve');
 await symlink(target,link,process.platform==='win32'?'junction':'dir');
 const plan=await prepareDesktop(c,{workspace:link});assert.equal(plan.workspace,await realpath(target));
 assert.equal(await readFile(join(plan.workspace,'sample.txt'),'utf8'),'preserve');
 const settings=JSON.parse(await readFile(join(plan.userDataDir,'User','settings.json'),'utf8'));
 assert(!Object.keys(settings).some(k=>/trust|allow|approve|access/i.test(k)));
});

test('unresolvable workspace fails rather than opening a guessed location',async t=>{
 const c=await fixture(t);
 await assert.rejects(prepareDesktop(c,{resolveRealPath:async()=>{throw new Error('denied');}}),{code:'workspace_resolution_failed'});
});
