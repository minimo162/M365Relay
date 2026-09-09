import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const {initialize}=createRequire(import.meta.url)('../vscode-bootstrap/extension.cjs');
const {recordWorkspace,stateLabel}=createRequire(import.meta.url)('../vscode-bootstrap/extension.cjs');

function fixture({globalValue=true,workspaceValue,attempted=false,models=[{id:'m365-copilot-ui'}]}={}){
 const calls=[],state=new Map([['attempted',attempted]]),commands=new Map();
 const context={subscriptions:[],globalState:{get:(k,d)=>state.get(k)??d,update:async(k,v)=>state.set(k,v)}};
 const vscode={workspace:{getConfiguration:()=>({inspect:()=>({globalValue,workspaceValue})})},
  commands:{registerCommand:(id,fn)=>{commands.set(id,fn);return {dispose(){}};},executeCommand:async id=>{assert.equal(state.get('attempted'),true);calls.push(id);}},
  lm:{selectChatModels:async filter=>{assert.deepEqual(filter,{vendor:'customendpoint'});return models;}},
  window:{tabGroups:{all:[],close:async()=>true},showWarningMessage:async()=>calls.push('warning')}};
 return {context,vscode,calls,state,commands};
}

test('first-run setup uses standard model management once and returns to chat',async()=>{
 const f=fixture();assert.equal(await initialize(f.context,f.vscode),true);
 assert.deepEqual(f.calls,['workbench.action.chat.manage','workbench.action.chat.open','workbench.action.maximizeAuxiliaryBar']);
 f.calls.length=0;assert.equal(await initialize(f.context,f.vscode),false);assert.deepEqual(f.calls,[]);
});

test('workspace settings cannot opt a normal profile into initialization',async()=>{
 const f=fixture({globalValue:false,workspaceValue:true});assert.equal(await initialize(f.context,f.vscode),false);
 await f.commands.get('m365Relay.prepareModels')();assert.deepEqual(f.calls,[]);assert.equal(f.state.get('attempted'),false);
});

test('failed setup does not loop on restart but supports an explicit retry',async()=>{
 const f=fixture({models:[]});assert.equal(await initialize(f.context,f.vscode),false);
 assert.deepEqual(f.calls,['workbench.action.chat.manage','warning']);f.calls.length=0;
 await initialize(f.context,f.vscode);assert.deepEqual(f.calls,[]);
 await f.commands.get('m365Relay.prepareModels')();assert.deepEqual(f.calls,['workbench.action.chat.manage','warning']);
});

test('workspace tracker stores the dedicated last folder without VS Code profile access',async t=>{
 const root=await mkdtemp(join(tmpdir(),'relay-extension-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const folder=join(root,'案件A'),stateFile=join(root,'workspace-state.json');await mkdir(folder);
 const previous=process.env.M365_RELAY_WORKSPACE_STATE;process.env.M365_RELAY_WORKSPACE_STATE=stateFile;
 t.after(()=>{if(previous===undefined)delete process.env.M365_RELAY_WORKSPACE_STATE;else process.env.M365_RELAY_WORKSPACE_STATE=previous;});
 await recordWorkspace({workspace:{workspaceFolders:[{uri:{fsPath:folder}}]}});
 assert.deepEqual(JSON.parse(await readFile(stateFile,'utf8')).path,folder);
});

test('status labels never call an unavailable model available',async()=>{
 assert.equal(stateLabel({server_state:'running',m365_state:'available',model_state:'verified'}),'利用可能');
 assert.equal(stateLabel({server_state:'running',m365_state:'available',model_state:'unavailable'}),'モデルを確認できません');
 assert.equal(stateLabel({server_state:'running',m365_state:'result_unconfirmed',model_state:'verified'}),'結果未確認');
});
