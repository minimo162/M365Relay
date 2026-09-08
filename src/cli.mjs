import { readFile, access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { homePath, initialize, loadConfig, ROOT } from './config.mjs';
import { acquireProcessLock, recoverProcessLock, Ledger } from './state.mjs';
import { createBridgeServer } from './server.mjs';
import { M365Backend, diagnoseBrowser } from './m365.mjs';
import { connectOwnedBrowser } from './cdp.mjs';
import { BridgeError, publicError, assert } from './errors.mjs';
import { findVSCode,prepareDesktop,launchDesktop } from './desktop.mjs';
import { createRunLog } from './run-log.mjs';
import { selectThinkDeeper } from './model-selection.mjs';
import { attachRequestImages } from './image-attachments.mjs';
import {existingDesktopPlan,registerDesktopInstance} from './desktop-instance.mjs';
import {reserveBridgePort} from './listen.mjs';
async function openEdge(config){
  assert(process.platform==='win32','windows_required','専用Edgeの自動起動はWindows用です。');
  // Never silently reuse an unrelated debugging port/profile.
  let portOpen=false;
  try{await fetch(`http://127.0.0.1:${config.cdpPort}/json/version`,{signal:AbortSignal.timeout(1000),redirect:'error'});portOpen=true;}catch{}
  if(portOpen){const c=await connectOwnedBrowser(config,AbortSignal.timeout(5000));c.close();console.log('専用Edgeは起動済みです。そのウィンドウでM365へサインインしてください。');return;}
  const roots=[process.env['ProgramFiles(x86)'],process.env.ProgramFiles,process.env.LOCALAPPDATA].filter(Boolean);
  let executable;
  for(const root of roots){const p=join(root,'Microsoft','Edge','Application','msedge.exe');try{await access(p);executable=p;break;}catch{}}
  assert(executable,'edge_not_found','Microsoft Edgeを見つけられません。');
  await mkdir(config.profileDir,{recursive:true});
  const child=spawn(executable,[`--remote-debugging-port=${config.cdpPort}`,'--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${config.profileDir}`,'--enable-automation','--no-first-run','--new-window',config.copilotUrl],{detached:true,stdio:'ignore',shell:false});
  await once(child,'spawn');child.unref();
  console.log('専用Edgeを起動しました。M365へ手動でサインインしてください。アカウント情報は読み取りません。');
}
async function writeVscodeExample(config){
  const v=[{name:'M365Relay',vendor:'customendpoint',apiKey:'${input:m365BridgeKey}',apiType:'chat-completions',
    models:[{id:'m365-copilot-ui',name:'M365 Copilot (M365Relay)',url:`http://127.0.0.1:${config.port}/v1/chat/completions`,
      toolCalling:true,vision:true,maxInputTokens:256000,maxOutputTokens:8000}]}];
  const p=join(config.home,'chatLanguageModels.example.json');await writeFile(p,JSON.stringify(v,null,2)+'\n',{mode:0o600});return p;
}
async function main(){
  const major=Number(process.versions.node.split('.')[0]),minor=Number(process.versions.node.split('.')[1]);
  assert(major>22 || major===22&&minor>=16,'node_version','Node.js 22.16以上が必要です。');
  const command=process.argv[2]??'help';
  if(command==='help'){console.log('Commands: run [workspace] | setup | init | open | diagnose | serve | recover-lock\nConfig/data: '+homePath());return;}
  if(command==='recover-lock'){await recoverProcessLock(homePath());console.log('停止済みプロセスの起動ロックを削除しました。要求台帳は保持しています。');return;}
  const config={...await loadConfig(),allowImages:true,attachToolDefinitions:true,attachConversation:true};
  let desktop;
  if(command==='setup'){
    assert(process.platform==='win32','windows_required','Run.cmdはWindows用です。');
    const executable=await findVSCode();
    desktop=await prepareDesktop(config,{executable,workspace:process.argv[3]});
    if(command==='setup'){
      console.log('初回設定が完了しました。接続キーやJSONを手で編集する必要はありません。\nRun.cmdを開くと、M365とVS Codeが起動します。\n作業フォルダー: '+desktop.workspace);return;
    }
  }
  if(command==='init'){
    const p=await writeVscodeExample(config);console.log(`設定を作成しました: ${config.home}\nVS Code設定例: ${p}\n接続キー: ${join(config.home,'token.txt')}\n接続キーの内容はログに表示しません。`);return;
  }
  if(command==='open'){await openEdge(config);return;}
  if(command==='diagnose'){console.log(JSON.stringify(await diagnoseBrowser(config),null,2));return;}
  if(command!=='serve'&&command!=='run')throw new BridgeError('unknown_command','help で利用可能なコマンドを確認してください。');
  let unlock;
  try{unlock=await acquireProcessLock(config.home);}catch(error){
    if(command!=='run'||error.code!=='already_running')throw error;
    // No profile setup, token transmission, lock recovery or request replay.
    const plan=await existingDesktopPlan(config,{workspace:process.argv[3]});
    plan.executable=await findVSCode();await launchDesktop(plan);
    console.log('起動済みのM365Relayの画面を開きました。');return;
  }
  let server,runLog;
  try{
    const template=await readFile(join(ROOT,'prompts','m365-tool-router.md'),'utf8');
    const ledger=new Ledger(config.home,config.token);await ledger.load();
    runLog=await createRunLog(config.home,{jsonConsole:process.env.M365_RELAY_JSON_LOGS==='1'});
    const log=record=>runLog.log(record);
    let proveInstance;
    server=createBridgeServer({config,template,backend:new M365Backend(config,{onMetrics:log,selectModel:selectThinkDeeper,attachImages:attachRequestImages}),ledger,log,instanceProof:nonce=>proveInstance?.(nonce)});
    const shutdown=async()=>{await server.stop();await runLog.flush();await unlock();process.exit(0);};
    process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
    const preferredPort=config.port;
    config.port=await reserveBridgePort(server,preferredPort,{allowFallback:command==='run'});
    if(config.port!==preferredPort)console.log(`接続には空きポート ${config.port} を使用します。`);
    // Reserve both the process lock and HTTP port before changing the dedicated profile.
    if(command==='run'){
      assert(process.platform==='win32','windows_required','Run.cmdはWindows用です。');
      const executable=await findVSCode();
      desktop=await prepareDesktop(config,{executable,workspace:process.argv[3]});
    }
    if(desktop){
      await openEdge(config);
      await launchDesktop(desktop);
      proveInstance=await registerDesktopInstance(config,desktop);
      console.log('接続の準備ができました。専用Edgeのサインインを確認し、VS Codeのチャットで依頼を入力してください。\nこのウィンドウを閉じると接続が終了します。');
    }
    const {version}=JSON.parse(await readFile(join(ROOT,'package.json'),'utf8'));
    console.log(`M365Relay ${version} (実M365で基本往復確認済み・ツール通し動作は検証中)\nEndpoint: http://127.0.0.1:${config.port}/v1/chat/completions\n終了: Ctrl+C`);
    if(runLog.path)console.log('診断ログ: '+runLog.path);
  }catch(error){if(server?.listening)await server.stop();await runLog?.flush();await unlock();throw error;}
}
main().catch(error=>{
  const safe=publicError(error);
  console.error(process.env.M365_RELAY_JSON_LOGS==='1'
    ?JSON.stringify({error:safe})
    :`M365Relayを開始・操作できませんでした。\n${safe.message}\n問い合わせ用コード: ${safe.code}`);
  process.exitCode=1;
});
