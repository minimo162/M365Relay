import {readFile,realpath,mkdir} from 'node:fs/promises';
import {dirname,join,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {assert,BridgeError} from './errors.mjs';

export async function vscodeCliPath(executable){
 const root=dirname(await realpath(executable));
 for(const name of ['code.cmd','code-insiders.cmd']){
  let text;try{text=await readFile(join(root,'bin',name),'utf8');}catch(e){if(e.code==='ENOENT')continue;throw e;}
  const matches=[...text.matchAll(/"(%~dp0[^"\r\n]*resources[\\/]app[\\/]out[\\/]cli\.js)"/gi)];
  if(matches.length!==1)continue;
  const cli=await realpath(resolve(root,'bin',matches[0][1].slice(5).replace(/[\\/]/g,sep)));
  const rel=relative(root,cli);
  assert(rel&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep),'vscode_cli_unavailable','VS Codeの初回準備用CLIを確認できません。',503);
  return cli;
 }
 throw new BridgeError('vscode_cli_unavailable','VS Codeの初回準備用CLIが見つかりません。標準のWindows版VS Codeを確認してください。',503);
}

export async function installBootstrap(plan,{bundleDir=fileURLToPath(new URL('../vscode-bootstrap/',import.meta.url)),run=promisify(execFile)}={}){
 if(!plan.extensionsDir)return;
 const metadata=JSON.parse(await readFile(join(bundleDir,'package.json'),'utf8'));
 assert(metadata.publisher==='m365relay'&&metadata.name==='first-run-model-setup'&&/^\d+\.\d+\.\d+$/.test(metadata.version),'invalid_bootstrap','初回準備用の配布情報が不正です。',503);
 const expected=await readFile(join(bundleDir,'extension.cjs'));
 await mkdir(plan.extensionsDir,{recursive:true});plan.extensionsDir=await realpath(plan.extensionsDir);
 const installed=join(plan.extensionsDir,`${metadata.publisher}.${metadata.name}-${metadata.version}`);
 const ready=async()=>{
  try{
   const m=JSON.parse(await readFile(join(installed,'package.json'),'utf8'));
   return m.name===metadata.name&&m.publisher===metadata.publisher&&m.version===metadata.version&&(await readFile(join(installed,'extension.cjs'))).equals(expected);
  }catch(e){if(e.code==='ENOENT')return false;throw e;}
 };
 if(await ready())return;
 const cli=await vscodeCliPath(plan.executable),vsix=await realpath(join(bundleDir,'first-run-model-setup.vsix'));
 const env={...process.env,ELECTRON_RUN_AS_NODE:'1',VSCODE_DEV:'',NODE_OPTIONS:'',NODE_PATH:''};delete env.VSCODE_IPC_HOOK_CLI;
 try{await run(plan.executable,[cli,'--user-data-dir',plan.userDataDir,'--extensions-dir',plan.extensionsDir,'--install-extension',vsix,'--do-not-sync'],{env,windowsHide:true,timeout:60000,maxBuffer:65536});}
 catch{throw new BridgeError('vscode_setup_failed','VS Codeの初回モデル準備に失敗しました。起動し直すか、VS Codeのインストール状態を確認してください。',503);}
 for(let n=0;n<100;n++){if(await ready())return;await delay(100);}
 throw new BridgeError('vscode_setup_failed','初回準備用拡張のインストールを確認できません。',503);
}
