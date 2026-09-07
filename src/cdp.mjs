import { assert, BridgeError, abortReason } from './errors.mjs';
export class CdpClient {
  constructor(socket) {
    this.socket=socket;this.next=1;this.pending=new Map();this.closed=false;
    socket.addEventListener('message',event=>{
      let m;try{m=JSON.parse(event.data);}catch{return;}
      if(!m.id)return;const p=this.pending.get(m.id);if(!p)return;
      this.pending.delete(m.id);p.cleanup();
      if(m.error)p.reject(new BridgeError('cdp_error',`ブラウザー操作 ${p.method} が失敗しました。`,502));else p.resolve(m.result??{});
    });
    const close=()=>{
      this.closed=true;
      for(const p of this.pending.values()){p.cleanup();p.reject(new BridgeError('cdp_disconnected','ブラウザーとの接続が切れました。自動再送はしません。',502));}
      this.pending.clear();
    };
    socket.addEventListener('close',close);socket.addEventListener('error',close);
  }
  static async connect(url,{signal,WebSocketClass=WebSocket}={}) {
    abortReason(signal);
    const socket=new WebSocketClass(url);const client=new CdpClient(socket);
    await new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);socket.removeEventListener('open',open);socket.removeEventListener('error',error);socket.removeEventListener('close',error);signal?.removeEventListener('abort',cancel);};
      const open=()=>{cleanup();resolve();};
      const error=()=>{cleanup();socket.close();reject(new BridgeError('cdp_unavailable','専用EdgeのCDPに接続できません。openコマンドで起動してください。',503));};
      const cancel=()=>{cleanup();socket.close();reject(signal.reason);};
      const timer=setTimeout(error,5000);
      socket.addEventListener('open',open,{once:true});socket.addEventListener('error',error,{once:true});socket.addEventListener('close',error,{once:true});signal?.addEventListener('abort',cancel,{once:true});
    });
    return client;
  }
  send(method,params={},sessionId,signal,timeoutMs=10000) {
    abortReason(signal);
    assert(!this.closed && this.socket.readyState===1,'cdp_disconnected','CDP接続は閉じています。',502);
    const id=this.next++;
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);};
      const cancel=()=>{this.pending.delete(id);cleanup();reject(signal.reason);};
      const timer=setTimeout(()=>{this.pending.delete(id);cleanup();reject(new BridgeError('cdp_timeout',`ブラウザー操作 ${method} の結果を確認できません。再実行しません。`,504));},timeoutMs);
      this.pending.set(id,{resolve,reject,cleanup,method});signal?.addEventListener('abort',cancel,{once:true});
      try{this.socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));}
      catch{this.pending.delete(id);cleanup();reject(new BridgeError('cdp_send_unknown','ブラウザー操作の送信結果が不明です。',502));}
    });
  }
  close(){try{this.socket.close();}catch{};}
}
export function assertWsUrl(raw,port) {
  let url;try{url=new URL(raw);}catch{throw new BridgeError('untrusted_cdp','CDPの接続先が不正です。',403);}
  assert(url.protocol==='ws:' && url.hostname==='127.0.0.1' && Number(url.port)===port && !url.username && !url.password && /^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(url.pathname) && !url.search && !url.hash,'untrusted_cdp','ローカル専用ブラウザー以外のCDPには接続しません。',403);
  return url.href;
}
export function verifyBrowserArguments(args,config) {
  assert(Array.isArray(args) && args.every(a=>typeof a==='string'),'profile_unverified','専用Edgeの起動引数を確認できません。',403);
  const flag=name=>{const entries=args.filter(a=>a.startsWith(`${name}=`));if(entries.length===1)return entries[0].slice(name.length+1);const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
  const normalize=p=>String(p??'').replace(/^"|"$/g,'').replace(/\//g,'\\').replace(/\\+$/,'').toLowerCase();
  assert(normalize(flag('--user-data-dir'))===normalize(config.profileDir) && flag('--remote-debugging-port')===String(config.cdpPort),'profile_mismatch','CDPポートが別のブラウザープロファイルに使われています。既存のブラウザーは操作しません。',403);
}
export async function connectOwnedBrowser(config,signal) {
  let version;
  try {
    const response=await fetch(`http://127.0.0.1:${config.cdpPort}/json/version`,{signal:AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(3000)]),redirect:'error'});
    assert(response.ok,'cdp_unavailable','専用Edgeが利用できません。',503);version=await response.json();
  } catch(error) { if(signal?.aborted)throw signal.reason; if(error instanceof BridgeError)throw error;throw new BridgeError('cdp_unavailable','専用Edgeが利用できません。Open-Copilot.cmdを実行してください。',503); }
  const ws=assertWsUrl(version.webSocketDebuggerUrl,config.cdpPort);
  const client=await CdpClient.connect(ws,{signal});
  try { const out=await client.send('Browser.getBrowserCommandLine',{},undefined,signal);verifyBrowserArguments(out.arguments,config);return client; }
  catch(error){client.close();throw error;}
}
