import {readFile,writeFile,mkdir,rename,unlink,stat,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {strictJson,isObject} from './json.mjs';
import {BridgeError,assert} from './errors.mjs';

const groupName='M365Relay';
async function optionalText(path){try{return await readFile(path,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function updateJson(path,transform){
 const before=await optionalText(path);
 const value=transform(before===null?undefined:strictJson(before));
 const after=JSON.stringify(value,null,2)+'\n';
 if(after===before)return;
 const temporary=path+'.'+randomUUID()+'.tmp';
 try{
  await writeFile(temporary,after,{flag:'wx',mode:0o600});
  assert(await optionalText(path)===before,'setup_changed','設定が別の操作で変更されました。上書きせず停止しました。',409);
  await rename(temporary,path);
 }finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}

export async function findVSCode({env=process.env,exists=access}={}){
 const candidates=[
  env.M365_RELAY_CODE,
  env.LOCALAPPDATA&&join(env.LOCALAPPDATA,'Programs','Microsoft VS Code','Code.exe'),
  env.ProgramFiles&&join(env.ProgramFiles,'Microsoft VS Code','Code.exe'),
  env['ProgramFiles(x86)']&&join(env['ProgramFiles(x86)'],'Microsoft VS Code','Code.exe')
 ].filter(Boolean);
 for(const executable of candidates){try{await exists(executable);return resolve(executable);}catch{}}
 throw new BridgeError('vscode_not_found','Visual Studio Codeが見つかりません。会社で利用できるVS Codeを用意してから、Run.cmdをもう一度実行してください。ポータブル版はM365_RELAY_CODEでCode.exeを指定できます。',503);
}

export async function prepareDesktop(config,{workspace,executable}={}){
 // This is a dedicated --user-data-dir, not the user's normal VS Code profile.
 const userDataDir=join(config.home,'vscode-data');
 const userDir=join(userDataDir,'User');
 const folder=workspace?resolve(workspace):join(config.home,'workspace');
 if(workspace){
  let directory=false;try{directory=(await stat(folder)).isDirectory();}catch{}
  assert(directory,'workspace_not_found','指定された作業フォルダーがありません。既存のフォルダーを指定してください。',400);
 }else{
  await mkdir(folder,{recursive:true});
  try{await writeFile(join(folder,'はじめに.md'),
   '# M365Relay\n\n1. 専用EdgeでM365 Copilotにサインインします。\n2. VS CodeのチャットでM365Relayを選び、依頼を入力します。\n3. 作業する別のフォルダーは「ファイル → フォルダーを開く」で選べます。\n\nVS Codeの承認画面で操作内容を確認してください。最初は非機密のファイルで動作を確認します。\n接続を終了するには、M365Relayの起動ウィンドウでCtrl+Cを押します。\n',
   {flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
 }
 await mkdir(userDir,{recursive:true});
 await updateJson(join(userDir,'chatLanguageModels.json'),groups=>{
  groups??=[];assert(Array.isArray(groups)&&groups.every(isObject),'invalid_desktop_config','専用VS Codeのモデル設定を読み取れません。既存設定は保持しています。');
  const matches=groups.filter(g=>g.name===groupName);
  assert(matches.length<=1&&matches.every(g=>g.vendor==='customendpoint'),'desktop_model_conflict','専用VS Codeに同名のモデル設定があります。既存設定は保持しています。',409);
  const old=matches[0];assert(!old||Array.isArray(old.models),'invalid_desktop_config','専用VS Codeのモデル一覧を読み取れません。');
  const models=old?.models??[];
  assert(models.every(isObject)&&models.filter(m=>m.id==='m365-copilot-ui').length<=1,'desktop_model_conflict','専用VS Codeのモデル定義が重複しています。');
  const prior=models.find(m=>m.id==='m365-copilot-ui')??{};
  const model={...prior,id:'m365-copilot-ui',name:'M365Relay',apiType:'chat-completions',url:`http://127.0.0.1:${config.port}/v1/chat/completions`,
   toolCalling:true,vision:false,maxInputTokens:24000,maxOutputTokens:8000,
   requestHeaders:{...prior.requestHeaders,Authorization:`Bearer ${config.token}`}};
  const group={...old,name:groupName,vendor:'customendpoint',apiType:'chat-completions',models:[...models.filter(m=>m.id!==model.id),model]};
  // apiKey needs a VS Code secret-storage reference; never write a placeholder
  // that silently resolves to no credential. The header is scoped to localhost.
  delete group.apiKey;
  return [...groups.filter(g=>g.name!==groupName),group];
 });
 await updateJson(join(userDir,'settings.json'),settings=>{
  settings??={};assert(isObject(settings),'invalid_desktop_config','専用VS Codeの設定を読み取れません。');
  // Keep explicit user preferences; the default avoids a separate paid model.
  return {'chat.byokUtilityModelDefault':'mainAgent',...settings};
 });
 return {executable,userDataDir,workspace:folder};
}

export async function launchDesktop(plan,{spawnProcess=spawn}={}){
 assert(plan.executable,'vscode_not_found','Visual Studio Codeが見つかりません。',503);
 const env={...process.env};
 for(const name of ['ELECTRON_RUN_AS_NODE','VSCODE_IPC_HOOK_CLI','NODE_OPTIONS','NODE_PATH'])delete env[name];
 const child=spawnProcess(plan.executable,['--user-data-dir',plan.userDataDir,'--new-window',plan.workspace],
  {detached:true,stdio:'ignore',shell:false,env});
 await once(child,'spawn');child.unref();
}
