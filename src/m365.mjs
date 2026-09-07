import { connectOwnedBrowser } from './cdp.mjs';
import { domExpression } from './dom.mjs';
import { safeDiagnostics } from './diagnostics.mjs';
import { parseEnvelope } from './protocol.mjs';
import { assert, BridgeError, delay, abortReason } from './errors.mjs';

export class M365Backend {
  constructor(config,{connect=connectOwnedBrowser,inputSettleMs=8000,inputPollMs=75,inputStableMs=250,sendReadyMs=15000,sendReadyStableMs=250,onMetrics=()=>{},responsePollMs=config.pollIntervalMs,responseStableMs=config.stableMs}={}){
    this.config=config;this.connect=connect;this.onMetrics=onMetrics;
    this.inputTiming={inputSettleMs,inputPollMs,inputStableMs,sendReadyMs,sendReadyStableMs};
    this.responseTiming={responsePollMs,responseStableMs};
  }
  async complete(request,{signal,onBeforeSend}) {
    const config=this.config;let browser,targetId,sessionId,sent=false,success=false,failure,phase = 'connect';
    const started=performance.now();let phaseStarted=started,snapshots=0,firstReplyMs=null,lastReplyChangeMs=null;
    const durations={};
    const enter=next=>{const now=performance.now();durations[phase]=(durations[phase]??0)+(now-phaseStarted);phase=next;phaseStarted=now;};
    const evaluate=async(operation,args={},s=signal)=>{
      const r=await browser.send('Runtime.evaluate',{expression:domExpression(config,operation,args),returnByValue:true,userGesture:true},sessionId,s,15000);
      const fail=raw=>{
        const details=safeDiagnostics({stage:'m365_dom',dom_operation:operation,
          dom_reason:raw?.reason,dom_tag:raw?.tag,
          ...(typeof args.expected==='string'?{expected_chars:args.expected.replace(/\r\n?/g,'\n').length}:{}),
          total_prompt_chars:request.prompt.length});
        details.dom_reason??='unknown_dom_exception';
        throw new BridgeError('m365_dom_changed',
          `M365画面を読み取れません（処理: ${details.dom_operation??'-'}、理由: ${details.dom_reason}${details.dom_tag?`、要素: ${details.dom_tag}`:''}）。入力を再挿入せず停止しました。`,502,details);
      };
      if(r.exceptionDetails)fail({reason:'unknown_dom_exception'});
      if(!r.result || !Object.hasOwn(r.result,'value'))fail({reason:'missing_dom_result'});
      const value=r.result.value;
      if(value&&Object.hasOwn(value,'__m365_relay_dom_error__'))fail(value.__m365_relay_dom_error__);
      return value;
    };
    const inputFailure=(code,check,expectedLength)=>{
      const c=(check&&typeof check==='object')?check:{};
      const observed=Number.isSafeInteger(c.observed_chars)?c.observed_chars:0;
      const difference=Number.isSafeInteger(c.first_difference)?c.first_difference:'-';
      return new BridgeError(code,
        `依頼文の入力を照合できません（入力予定 ${expectedLength} 文字、読取 ${observed} 文字、差分位置 ${difference}）。送信せず停止しました。`,
        502,{stage:'editor_input',...c,expected_chars:Number.isSafeInteger(c.expected_chars)?c.expected_chars:expectedLength,observed_chars:observed,total_prompt_chars:request.prompt.length});
    };
    const internalFailure=error=>new BridgeError('backend_internal_error',
      `M365連携の内部処理で停止しました（段階: ${phase}）。自動再送はしません。`,502,
      {stage:'backend',backend_phase:phase,total_prompt_chars:request.prompt.length});
    const checkInput=expected=>evaluate('verifyInput',{expected});
    // Allow the editor to reconcile its DOM. Read again, never insert again.
    // Two matching reads separated by a quiet interval are required per chunk.
    const settleInput=async expected=>{
      const {inputSettleMs,inputPollMs,inputStableMs}=this.inputTiming;
      const until=Date.now()+inputSettleMs;let matchedSince,last,lastReadError;
      do {
        abortReason(signal);
        try{last=await checkInput(expected);lastReadError=undefined;}
        catch(error){
          // Reconciliation can briefly introduce an unreadable node. This is a
          // bounded read-only wait, never a second insertion or a resend.
          if(!(error instanceof BridgeError)||error.code!=='m365_dom_changed'||
            !['unsupported_editor','unsupported_editor_node','nontext_editor_node'].includes(error.details?.dom_reason))throw error;
          lastReadError=error;last=undefined;
        }
        if(last?.matched){matchedSince??=Date.now();if(Date.now()-matchedSince>=inputStableMs)return;}
        else matchedSince=undefined;
        if(Date.now()>=until)break;
        await delay(inputPollMs,signal);
      }while(true);
      if(lastReadError)throw lastReadError;
      throw inputFailure('input_mismatch',last,expected.length);
    };
    try {
      enter('connect');browser=await this.connect(config,signal);
      enter('open_tab');({targetId}=await browser.send('Target.createTarget',{url:config.copilotUrl,background:false},undefined,signal));
      enter('attach_tab');({sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true},undefined,signal));
      enter('wait_editor');const deadline=Date.now()+config.readyTimeoutMs;let state;
      while(Date.now()<deadline){
        abortReason(signal);
        const loc=await browser.send('Runtime.evaluate',{expression:'location.origin',returnByValue:true},sessionId,signal);
        const origin=loc.result?.value;
        if(origin===config.origin){state=await evaluate('snapshot');if(state.editor)break;}
        else if(typeof origin==='string' && /^https:\/\/(login|account|login\.live)/.test(origin))throw new BridgeError('sign_in_required','専用EdgeでM365へサインインしてから、VS Codeで新しい依頼を開始してください。',503);
        await delay(config.pollIntervalMs,signal);
      }
      assert(state?.editor,'editor_not_ready','M365入力欄を確認できません。専用Edgeを前面表示してサインインを確認してください。',503);
      // Root navigation can restore an old conversation. Never assume a new tab is a new chat.
      if(state.nonempty || state.input.trim() || state.busy){enter('reset_conversation');
        assert((await evaluate('newChat')).clicked,'new_chat_required','空の会話を確保できません。既存の会話や入力欄は上書きしません。',409);
        const resetDeadline=Date.now()+15000;
        do {await delay(config.pollIntervalMs,signal);state=await evaluate('snapshot');if(state.editor&&!state.nonempty&&!state.input.trim()&&!state.busy)break;}while(Date.now()<resetDeadline);
      }
      assert(state.editor&&!state.nonempty&&!state.input.trim()&&!state.busy,'conversation_not_empty','会話の初期化を確認できません。送信を停止します。',409);
      // One CDP text insertion behaves like a paste without touching the user's clipboard.
      // There is no per-chunk typing loop: insert once, then verify the complete prompt
      // repeatedly until the DOM is stable. On mismatch we never insert again.
      enter('input_before');const before=await checkInput('');
      if(!before.matched)throw inputFailure('input_changed',before,0);
      enter('input_focus');assert((await evaluate('focus')).focused,'focus_failed','入力欄へフォーカスできません。',502);
      enter('input_insert');await browser.send('Input.insertText',{text:request.prompt},sessionId,signal,30000);
      enter('input_settle');await settleInput(request.prompt);
      // A very large single insertion can be text-complete before M365 finishes
      // enabling/rendering its send control. Poll read-only; never insert again.
      enter('send_ready');
      {
        const {sendReadyMs,sendReadyStableMs,inputPollMs}=this.inputTiming;
        const until=Date.now()+sendReadyMs;let readySince,last;
        do {
          abortReason(signal);
          last=await evaluate('sendReady',{expected:request.prompt});
          if(last?.input&&!last.input.matched)throw inputFailure('input_changed',last.input,request.prompt.length);
          if(last?.ready){readySince??=Date.now();if(Date.now()-readySince>=sendReadyStableMs)break;}
          else readySince=undefined;
          if(Date.now()>=until)throw new BridgeError('send_not_ready',
            '依頼文の全文一致は確認できましたが、M365の送信ボタンが有効になりませんでした。再入力・送信せず停止しました。',502,
            {stage:'send_ready',total_prompt_chars:request.prompt.length,button_found:!!last?.button,button_enabled:!!last?.enabled,busy:!!last?.busy});
          await delay(inputPollMs,signal);
        }while(true);
      }
      enter('before_send');await onBeforeSend();sent=true; // Conservative: the following click may succeed even if its result is lost.
      enter('send');const clicked=await evaluate('send',{expected:request.prompt});
      if(clicked.input&&!clicked.input.matched)throw inputFailure('input_changed',clicked.input,request.prompt.length);
      assert(clicked.clicked,'send_unknown','送信クリックの結果が不明です。',502);
      let lastKey='',stableSince=Date.now(),lastError;
      enter('response_wait');while(true){
        abortReason(signal);await delay(this.responseTiming.responsePollMs,signal);
        state=await evaluate('snapshot');snapshots++;
        if(state.nonempty&&firstReplyMs===null)firstReplyMs=performance.now()-started;
        const key=JSON.stringify(state.candidates);
        if(key!==lastKey){lastKey=key;stableSince=Date.now();lastReplyChangeMs=performance.now()-started;}
        if(state.busy || !state.nonempty || Date.now()-stableSince<this.responseTiming.responseStableMs)continue;
        // A strict assistant-only DOM selector is mandatory. No document.body fallback.
        enter('response_validate');for(const candidate of state.candidates){
          try{parseEnvelope(candidate,request);success=true;return candidate;}
          catch(error){lastError=error;}
        }
        throw new BridgeError('m365_response_invalid','生成が終了しましたが、完全なJSON・要求ID・ツール引数を検証できません。回答の修復や再送はしません。',502,
          {validation_code:lastError?.code??'invalid_json'});
      }
    } catch(error) {
      failure=error instanceof BridgeError || error?.name==='AbortError' || error?.name==='TimeoutError' ? error : internalFailure(error);
      throw failure;
    } finally {
      // Only our owned request tab is stopped/closed. Never terminate Edge or touch other apps.
      enter('cleanup');if(browser&&sessionId&&sent&&!success){
        try{await evaluate('stop',{},AbortSignal.timeout(2000));}catch{}
      }
      // Pre-send failures are safe to close because nothing was submitted. Keep a
      // sign-in tab visible so the user can authenticate. Post-send uncertainty
      // remains visible for diagnosis because the request may already exist in M365.
      const closePreSendFailure=!sent&&failure?.code!=='sign_in_required';
      if(browser&&targetId&&(success||signal?.aborted||closePreSendFailure)){
        try{await browser.send('Target.closeTarget',{targetId},undefined,AbortSignal.timeout(2000),2000);}catch{}
      }
      browser?.close();
      const finished=performance.now();
      durations[phase]=(durations[phase]??0)+(finished-phaseStarted);
      const metrics={event:'backend_timing',request_id:request.requestId,
        outcome:success?'success':signal?.aborted?'cancelled':'error',possibly_sent:sent,
        total_ms:Math.round(finished-started),phase_ms:Object.fromEntries(Object.entries(durations).map(([k,v])=>[k,Math.round(v)])),
        response_snapshots:snapshots,first_reply_observed_ms:firstReplyMs===null?null:Math.round(firstReplyMs),
        last_reply_change_observed_ms:lastReplyChangeMs===null?null:Math.round(lastReplyChangeMs)};
      // Telemetry must never turn a completed operation into an apparent failure.
      try{Promise.resolve(this.onMetrics(metrics)).catch(()=>{});}catch{}
    }
  }
}
export async function diagnoseBrowser(config){
  const signal=AbortSignal.timeout(10000),browser=await connectOwnedBrowser(config,signal);
  try{const {targetInfos}=await browser.send('Target.getTargets',{},undefined,signal);
    return {profile_verified:true,m365_tabs:(targetInfos??[]).filter(t=>{try{return t.type==='page'&&new URL(t.url).origin===config.origin;}catch{return false;}}).length,
      live_send_performed:false};
  }finally{browser.close();}
}
