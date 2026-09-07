import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { strictJson } from './json.mjs';
import { prepareRequest, parseEnvelope, completion, streamChunks, MODEL } from './protocol.mjs';
import { SerialQueue } from './state.mjs';
import { assert, BridgeError, publicError, abortReason } from './errors.mjs';
function json(res,status,value) {
  if(res.destroyed || res.writableEnded)return;
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value));
}
function equal(a,b) {const x=Buffer.from(a),y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y);}
async function bodyText(req,maxBytes) {
  const chunks=[];let bytes=0;
  for await(const c of req) {bytes+=c.length;assert(bytes<=maxBytes,'request_too_large','HTTP要求が上限を超えました。',413);chunks.push(c);}
  try{return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}
  catch{throw new BridgeError('invalid_utf8','要求はUTF-8である必要があります。');}
}
export function createBridgeServer({config,template,backend,ledger,log=()=>{}}) {
  const queue=new SerialQueue(config.maxQueue);const controllers=new Set();
  const server=http.createServer(async(req,res)=>{
    let parsed, timer, release, fingerprint, possiblySent=false, settled=false;
    const client=new AbortController();controllers.add(client);
    const signal=AbortSignal.any([client.signal,AbortSignal.timeout(config.requestTimeoutMs)]);
    const aborted=()=>{if(!res.writableEnded)client.abort(new DOMException('Client disconnected','AbortError'));};
    req.once('aborted',aborted);res.once('close',aborted);
    try {
      const port=server.address()?.port;
      assert([`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host),'bad_host','ループバック以外のHostは受理しません。',403);
      assert(!req.headers.origin,'cross_origin','ブラウザーからのクロスオリジン要求は受理しません。',403);
      if(req.method==='GET' && req.url==='/health')return json(res,200,{status:'ready',backend:'m365-cdp',live_verified:false,model:MODEL});
      assert(equal(req.headers.authorization??'',`Bearer ${config.token}`),'unauthorized','ローカル接続キーが必要です。',401);
      if(req.method==='GET' && req.url==='/v1/models')return json(res,200,{object:'list',data:[{id:MODEL,object:'model',created:0,owned_by:'local-m365-ui-bridge'}]});
      assert(req.method==='POST' && req.url==='/v1/chat/completions','not_found','このエンドポイントは対応していません。',404);
      assert((req.headers['content-type']??'').toLowerCase().split(';')[0].trim()==='application/json','content_type','Content-Type: application/json が必要です。',415);
      const body=strictJson(await bodyText(req,2*1024*1024));
      parsed=prepareRequest(body,template,config);
      release=await queue.acquire(signal);abortReason(signal);
      fingerprint=await ledger.reserve(parsed);
      log({request_id:parsed.requestId,event:'accepted',prompt_chars:parsed.prompt.length,tools:parsed.payload.tools.length});
      if(parsed.stream) {
        res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
        res.write(': bridge waiting for a complete validated response\n\n');
        timer=setInterval(()=>{if(!res.destroyed&&!res.writableEnded)res.write(': waiting\n\n');},5000);timer.unref();
      }
      const raw=await backend.complete(parsed,{signal,onBeforeSend:async()=>{
        abortReason(signal); await ledger.set(fingerprint,'sending'); possiblySent=true;
      }});
      abortReason(signal);
      const envelope=parseEnvelope(raw,parsed);const result=completion(envelope,parsed);
      // Persist BEFORE returning. A lost response is not silently replayed by this bridge.
      await ledger.set(fingerprint,'response_validated');settled=true;abortReason(signal);
      if(parsed.stream) {for(const c of streamChunks(result))res.write(`data: ${JSON.stringify(c)}\n\n`);res.end('data: [DONE]\n\n');}
      else json(res,200,result);
      log({request_id:parsed.requestId,event:'response_returned',kind:envelope.action});
    } catch(error) {
      const safe=publicError(error);
      if(fingerprint&&!settled) {
        try{await ledger.set(fingerprint,possiblySent?'unknown_or_invalid':'not_sent');}catch{}
      }
      log({request_id:parsed?.requestId??null,event:'error',code:safe.code});
      if(!res.destroyed&&!res.writableEnded) {
        if(res.headersSent) {res.write(`data: ${JSON.stringify({error:safe})}\n\n`);res.end('data: [DONE]\n\n');}
        else json(res,error instanceof BridgeError?error.status:signal.aborted?504:500,{error:safe});
      }
    } finally {
      clearInterval(timer);release?.();controllers.delete(client);req.removeListener('aborted',aborted);res.removeListener('close',aborted);
    }
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  server.stop=async()=>{
    for(const c of controllers)c.abort(new DOMException('Server shutting down','AbortError'));
    await new Promise(resolve=>server.close(resolve));server.closeAllConnections();
  };
  return server;
}
