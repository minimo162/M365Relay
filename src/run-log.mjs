import {mkdir,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {safeDiagnostics} from './diagnostics.mjs';

const phases=['connect','open_tab','attach_tab','wait_editor','reset_conversation','model_select','image_attach','editor_stable','input_before','input_focus','input_insert','input_settle','send_ready','before_send','send','response_wait','response_validate','cleanup'];
export function logMetadata(record){
  if(!['desktop_launch','queued','accepted','response_returned','error','backend_timing','backend_state'].includes(record?.event))return null;
  const out={time:new Date().toISOString(),event:record.event};
  if(typeof record.request_id==='string'&&/^[a-f0-9-]{36}$/i.test(record.request_id))out.request_id=record.request_id;
  for(const key of ['prompt_chars','tools','queue_wait_ms','queue_depth','total_ms','response_snapshots','first_reply_observed_ms','last_reply_change_observed_ms']){
    if(Number.isSafeInteger(record[key])&&record[key]>=0)out[key]=record[key];
  }
  if(['tool_calls','final'].includes(record.kind))out.kind=record.kind;
  if(['window','handoff','failed','unconfirmed'].includes(record.desktop_status))out.desktop_status=record.desktop_status;
  if(Number.isSafeInteger(record.exit_code))out.exit_code=record.exit_code;
  if(['success','error','cancelled'].includes(record.outcome))out.outcome=record.outcome;
  if(phases.includes(record.backend_phase))out.backend_phase=record.backend_phase;
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
      else if(safe.event==='accepted')print('M365へ資料を渡す準備をしています。');
      else if(safe.event==='backend_state'){
        const labels={connect:'M365接続を開始しています。',open_tab:'専用M365画面を開いています。',attach_tab:'M365画面を確認しています。',wait_editor:'サインインと入力欄を確認しています。',reset_conversation:'新しい会話を準備しています。',model_select:'指定モデルを確認しています。',image_attach:'資料を渡しています。',editor_stable:'入力欄の安定を確認しています。',input_before:'依頼文を検証しています。',input_focus:'入力欄を準備しています。',input_insert:'依頼文を渡しています。',input_settle:'渡した依頼文を照合しています。',send_ready:'送信条件を確認しています。',before_send:'送信直前の条件を確認しています。',send:'M365へ送信しました。',response_wait:'M365の回答を待っています。',response_validate:'回答の完全性を確認しています。',cleanup:'接続を終了しています。'};
        print(labels[safe.backend_phase]??'M365連携の状態を確認しています。');
      }
      else if(safe.event==='response_returned')print(safe.kind==='tool_calls'?'次の操作をVS Codeへ渡しました。':'応答をVS Codeへ返しました。');
      else if(safe.event==='error'){
        const message=safe.code==='sign_in_required'?'M365へのサインインが必要です。専用Edgeを確認してください。':
          ['m365_response_invalid','send_unknown','backend_internal_error','cancelled_or_timed_out'].includes(safe.code)?'結果を確認できないため停止しました。自動再送はしません。':
          `処理が停止しました（${safe.code??'unknown_error'}）。VS Codeの表示を確認してください。`;
        print(message);
      }
      if(!writable)return;
      const size=Buffer.byteLength(line);if(bytes+size>maxBytes){writable=false;warn('今回の診断ログが保存上限に達しました。処理は継続します。');return;}
      bytes+=size;pending=pending.then(()=>append(path,line,{encoding:'utf8',mode:0o600})).catch(unavailable);
    },
    flush(){return pending;}
  };
}
