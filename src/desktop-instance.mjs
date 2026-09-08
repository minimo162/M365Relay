import {readFile,writeFile,realpath,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {strictJson,isObject} from './json.mjs';
import {assert,BridgeError} from './errors.mjs';

const proofFor=(token,nonce,digest)=>createHmac('sha256',token).update(`m365-relay.desktop.v1\n${nonce}\n${digest}`).digest('hex');
const digestOf=text=>createHash('sha256').update(text).digest('hex');
// Only local metadata contains paths. The network response proves possession
// of this instance's key and snapshot without receiving the connection key.
export async function registerDesktopInstance(config,plan){
 const lock=join(config.home,'bridge.lock');
 const owner=strictJson(await readFile(join(lock,'owner.json'),'utf8'));
 assert(isObject(owner)&&owner.pid===process.pid&&Number.isFinite(Date.parse(owner.started)),'instance_owner_changed','起動所有者が変わったため停止しました。',409);
 const text=JSON.stringify({version:1,pid:owner.pid,started:owner.started,plan});
 await writeFile(join(lock,'desktop.json'),text,{flag:'wx',mode:0o600});
 const digest=digestOf(text);
 return nonce=>({proof:proofFor(config.token,nonce,digest)});
}

export async function existingDesktopPlan(config,{workspace,fetchImpl=fetch,alive=pid=>process.kill(pid,0)}={}){
 const lock=join(config.home,'bridge.lock'),path=join(lock,'desktop.json');
 let text,ownerText;
 try{text=await readFile(path,'utf8');ownerText=await readFile(join(lock,'owner.json'),'utf8');}
 catch{throw new BridgeError('instance_not_ready','起動済みの画面を確認できません。準備中なら少し待って起動し直してください。旧版や異常終了の場合は既存の起動ウィンドウを確認してください。',409);}
 const instance=strictJson(text,{maxBytes:32768}),owner=strictJson(ownerText);
 assert(isObject(instance)&&isObject(owner)&&instance.version===1&&Number.isInteger(instance.pid)&&instance.pid>0&&instance.pid===owner.pid&&instance.started===owner.started&&Number.isFinite(Date.parse(owner.started))&&isObject(instance.plan),'instance_unverifiable','起動済みの情報を確認できません。',409);
 try{alive(instance.pid);}catch{throw new BridgeError('instance_unverifiable','起動済みのプロセスを確認できません。Recover.cmdで復旧してください。',409);}
 const nonce=randomBytes(32).toString('hex');
 const port=instance.plan.port??config.port;
 assert(Number.isInteger(port)&&port>=1024&&port<=65535,'instance_unverifiable','起動済みの接続ポートを確認できません。',409);
 let proof;
 try{
  const response=await fetchImpl(`http://127.0.0.1:${port}/desktop-instance?nonce=${nonce}`,{redirect:'error',signal:AbortSignal.timeout(2500)});
  assert(response.ok,'instance_unverifiable','起動済みの接続を確認できません。',409);
  const reader=response.body.getReader();let bytes=0,chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;assert(bytes<=1024,'instance_unverifiable','接続確認の応答が不正です。',409);chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  proof=strictJson(Buffer.concat(chunks).toString('utf8')).proof;
 }catch{throw new BridgeError('instance_unverifiable','起動済みの接続先を確認できません。既存の起動ウィンドウを確認してください。',409);}
 const expected=proofFor(config.token,nonce,digestOf(text));
 assert(typeof proof==='string'&&/^[0-9a-f]{64}$/.test(proof)&&timingSafeEqual(Buffer.from(proof),Buffer.from(expected)),'instance_unverifiable','別の接続先の可能性があるため画面を開きません。',409);
 assert(await readFile(path,'utf8')===text&&await readFile(join(lock,'owner.json'),'utf8')===ownerText,'instance_owner_changed','接続の所有者が変わりました。もう一度起動してください。',409);
 const plan=instance.plan;let profile;
 try{profile=await realpath(join(config.home,'vscode-data'));assert(typeof plan.userDataDir==='string'&&await realpath(plan.userDataDir)===profile,'instance_unverifiable','専用プロファイルが一致しません。',409);}
 catch{throw new BridgeError('instance_unverifiable','専用プロファイルの保存先を確認できません。',409);}
 const folder=workspace?resolve(workspace):plan.workspace;
 let actualFolder;
 try{assert(typeof folder==='string'&&(await stat(folder)).isDirectory(),'workspace_not_found','作業フォルダーを確認できません。',400);actualFolder=await realpath(folder);}
 catch{throw new BridgeError('workspace_not_found','作業フォルダーを確認できません。既存のフォルダーを指定してください。',400);}
 return {...plan,userDataDir:profile,workspace:actualFolder};
}
