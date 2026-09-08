import {BridgeError} from './errors.mjs';

function listen(server,port){
 return new Promise((resolve,reject)=>{
  const failed=error=>{server.removeListener('listening',ready);reject(error);};
  const ready=()=>{server.removeListener('error',failed);resolve(server.address().port);};
  server.once('error',failed);server.once('listening',ready);
  server.listen(port,'127.0.0.1');
 });
}

export async function reserveBridgePort(server,preferred,{allowFallback=false}={}){
 try{return await listen(server,preferred);}catch(error){
  if(error.code!=='EADDRINUSE')throw error;
  if(allowFallback)return listen(server,0);
  throw new BridgeError('bridge_port_in_use',`接続ポート ${preferred} は使用中です。通常起動のRun.cmdは空きポートを自動選択します。固定ポートでserveを使う場合は設定を確認してください。`,409);
 }
}
