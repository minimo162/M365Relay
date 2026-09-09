import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { strictJson } from './json.mjs';
import { prepareRequest, parseEnvelope, completion, streamChunks, MODEL } from './protocol.mjs';
import { SerialQueue } from './state.mjs';
import { assert, BridgeError, publicError, abortReason, MODEL_UNAVAILABLE_CODES, RESULT_UNCONFIRMED_CODES } from './errors.mjs';
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
export function createBridgeServer({config,template,backend,ledger,log=()=>{},instanceProof=()=>undefined,now=()=>performance.now()}) {
  const queue=new SerialQueue(config.maxQueue);const controllers=new Set();
  const status={server_state:'running',m365_state:'not_verified',model_state:'not_verified'};
  const server=http.createServer(async(req,res)=>{
    let parsed, timer, release, fingerprint, queueStarted, queueWaitMs, possiblySent=false, settled=false;
    const client=new AbortController();controllers.add(client);
    const signal=AbortSignal.any([client.signal,AbortSignal.timeout(config.requestTimeoutMs)]);
    const aborted=()=>{if(!res.writableEnded)client.abort(new DOMException('Client disconnected','AbortError'));};
    req.once('aborted',aborted);res.once('close',aborted);
    try {
      const port=server.address()?.port;
      assert([`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host),'bad_host','ループバック以外のHostは受理しません。',403);
      assert(!req.headers.origin,'cross_origin','ブラウザーからのクロスオリジン要求は受理しません。',403);
      if(req.method==='GET' && req.url==='/health')return json(res,200,{status:'running',backend:'m365-cdp',live_verified:false,model:MODEL,...status});
      if(req.method==='GET'&&/^\/desktop-instance\?nonce=[0-9a-f]{64}$/.test(req.url)){
        const proof=instanceProof(req.url.slice(req.url.indexOf('=')+1));
        assert(proof,'instance_not_ready','画面の起動準備中です。',409);
        return json(res,200,proof);
      }
      assert(equal(req.headers.authorization??'',`Bearer ${config.token}`),'unauthorized','ローカル接続キーが必要です。',401);
      if(req.method==='GET' && req.url==='/v1/models')return json(res,200,{object:'list',data:[{id:MODEL,object:'model',created:0,owned_by:'local-m365-ui-bridge'}]});
      assert(req.method==='POST' && req.url==='/v1/chat/completions','not_found','このエンドポイントは対応していません。',404);
      assert((req.headers['content-type']??'').toLowerCase().split(';')[0].trim()==='application/json','content_type','Content-Type: application/json が必要です。',415);
      const maxBodyBytes=(config.allowImages?20:2)*1024*1024;
      const body=strictJson(await bodyText(req,maxBodyBytes),{maxBytes:maxBodyBytes});
      parsed=prepareRequest(body,template,config);
      queueStarted=now();
      if(queue.active&&queue.waiters.length<queue.maxQueue)log({request_id:parsed.requestId,event:'queued',queue_depth:queue.waiters.length+1});
      release=await queue.acquire(signal);queueWaitMs=Math.round(now()-queueStarted);abortReason(signal);
      fingerprint=await ledger.reserve(parsed);
      log({request_id:parsed.requestId,event:'accepted',queue_wait_ms:queueWaitMs,prompt_chars:parsed.prompt.length,tools:parsed.payload.tools.length});
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
      status.m365_state='available';status.model_state='verified';
      // Persist BEFORE returning. A lost response is not silently replayed by this bridge.
      await ledger.set(fingerprint,'response_validated');settled=true;abortReason(signal);
      if(parsed.stream) {for(const c of streamChunks(result))res.write(`data: ${JSON.stringify(c)}\n\n`);res.end('data: [DONE]\n\n');}
      else json(res,200,result);
      log({request_id:parsed.requestId,event:'response_returned',kind:envelope.action});
    } catch(error) {
      const safe=publicError(error);
      if(safe.code==='sign_in_required'){
        status.m365_state='sign_in_required';
        status.model_state='not_verified';
      } else if(MODEL_UNAVAILABLE_CODES.includes(safe.code)){
        // A previous successful request must not make a failed model check
        // look usable. M365 itself may still be signed in, but this request
        // did not verify the requested model.
        status.m365_state='not_verified';
        status.model_state='unavailable';
      } else if(possiblySent || RESULT_UNCONFIRMED_CODES.includes(safe.code)){
        // After onBeforeSend, the bridge cannot know whether M365 committed
        // the request. Expose that uncertainty and never leave available /
        // verified from an earlier request in place.
        status.m365_state='result_unconfirmed';
        status.model_state='not_verified';
      } else if(['cdp_unavailable','editor_not_ready','conversation_not_empty','new_chat_required'].includes(safe.code)){
        status.m365_state='not_verified';
        status.model_state='not_verified';
      }
      if(fingerprint&&!settled) {
        try{await ledger.set(fingerprint,possiblySent?'unknown_or_invalid':'not_sent');}catch{}
      }
      log({request_id:parsed?.requestId??null,event:'error',code:safe.code,details:safe.details,
        queue_wait_ms:queueWaitMs??(queueStarted===undefined?undefined:Math.round(now()-queueStarted))});
      if(!res.destroyed&&!res.writableEnded) {
        if(res.headersSent) {res.write(`data: ${JSON.stringify({error:safe})}\n\n`);res.end('data: [DONE]\n\n');}
        else json(res,error instanceof BridgeError?error.status:(safe.code==='cancelled_or_timed_out'||signal.aborted)?504:500,{error:safe});
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
