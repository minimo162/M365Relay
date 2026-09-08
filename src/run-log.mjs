import {mkdir,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {safeDiagnostics} from './diagnostics.mjs';

const phases=['connect','open_tab','attach_tab','wait_editor','reset_conversation','model_select','image_attach','editor_stable','input_before','input_focus','input_insert','input_settle','send_ready','before_send','send','response_wait','response_validate','cleanup'];
export function logMetadata(record){
  if(!['desktop_launch','queued','accepted','response_returned','error','backend_timing'].includes(record?.event))return null;
  const out={time:new Date().toISOString(),event:record.event};
  if(typeof record.request_id==='string'&&/^[a-f0-9-]{36}$/i.test(record.request_id))out.request_id=record.request_id;
  for(const key of ['prompt_chars','tools','queue_wait_ms','queue_depth','total_ms','response_snapshots','first_reply_observed_ms','last_reply_change_observed_ms']){
    if(Number.isSafeInteger(record[key])&&record[key]>=0)out[key]=record[key];
  }
  if(['tool_calls','final'].includes(record.kind))out.kind=record.kind;
  if(['window','handoff','failed','unconfirmed'].includes(record.desktop_status))out.desktop_status=record.desktop_status;
  if(Number.isSafeInteger(record.exit_code))out.exit_code=record.exit_code;
  if(['success','error','cancelled'].includes(record.outcome))out.outcome=record.outcome;
  if(typeof record.possibly_sent==='boolean')out.possibly_sent=record.possibly_sent;
  if(typeof record.code==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(record.code))out.code=record.code;
  const details=safeDiagnostics(record.details);if(Object.keys(details).length)out.details=details;
  if(record.phase_ms&&typeof record.phase_ms==='object')out.phase_ms=Object.fromEntries(phases.filter(k=>Number.isSafeInteger(record.phase_ms[k])&&record.phase_ms[k]>=0).map(k=>[k,record.phase_ms[k]]));
  return out;
}

export async function createRunLog(home,{print=console.log,warn=console.error,jsonConsole=false,maxBytes=2*1024*1024,append=appendFile}={}){
  const directory=join(home,'logs'),path=join(directory,`run-${randomUUID()}.jsonl`);
  let writable=true,reported=false,pending=Promise.resolve(),bytes=0;
  const unavailable=()=>{writable=false;if(!reported){reported=true;warn('診断ログを保存できません。処理は継続します。');}};
  try{await mkdir(directory,{recursive:true});}catch{unavailable();}
  return {path:writable?path:null,
    log(record){
      const safe=logMetadata(record);if(!safe)return;
      const line=JSON.stringify(safe)+'\n';
      if(jsonConsole)print(line.trimEnd());
      else if(safe.event==='queued')print('先行する要求の完了を待っています。');
      else if(safe.event==='accepted')print('M365で処理中です。');
      else if(safe.event==='response_returned')print(safe.kind==='tool_calls'?'次の操作をVS Codeへ渡しました。':'応答をVS Codeへ返しました。');
      else if(safe.event==='error')print(`処理が停止しました（${safe.code??'unknown_error'}）。VS Codeの表示を確認してください。`);
      if(!writable)return;
      const size=Buffer.byteLength(line);if(bytes+size>maxBytes){writable=false;warn('今回の診断ログが保存上限に達しました。処理は継続します。');return;}
      bytes+=size;pending=pending.then(()=>append(path,line,{encoding:'utf8',mode:0o600})).catch(unavailable);
    },
    flush(){return pending;}
  };
}
