import { connectOwnedBrowser } from './cdp.mjs';
import { domExpression } from './dom.mjs';
import { parseEnvelope } from './protocol.mjs';
import { assert, BridgeError, delay, abortReason } from './errors.mjs';

export class M365Backend {
  constructor(config,{connect=connectOwnedBrowser,inputSettleMs=3000,inputPollMs=100,inputStableMs=200}={}){
    this.config=config;this.connect=connect;
    this.inputTiming={inputSettleMs,inputPollMs,inputStableMs};
  }
  async complete(request,{signal,onBeforeSend}) {
    const config=this.config;let browser,targetId,sessionId,sent=false,success=false;
    const evaluate=async(operation,args={},s=signal)=>{
      const r=await browser.send('Runtime.evaluate',{expression:domExpression(config,operation,args),returnByValue:true,userGesture:true},sessionId,s,15000);
      if(r.exceptionDetails)throw new BridgeError('m365_dom_changed','M365画面の操作対象または状態を確認できません。ログイン状態・表示・セレクターを確認してください。',502);
      assert(r.result && Object.hasOwn(r.result,'value'),'m365_dom_changed','M365画面の状態を取得できません。',502);
      return r.result.value;
    };
    const inputFailure=(code,check,expectedLength)=>new BridgeError(code,
      `依頼文の入力を照合できません（入力予定 ${expectedLength} 文字、読取 ${check.observed_chars} 文字、差分位置 ${check.first_difference??'-'}）。送信せず停止しました。`,
      502,{stage:'editor_input',...check,total_prompt_chars:request.prompt.length});
    const checkInput=expected=>evaluate('verifyInput',{expected});
    // Allow the editor to reconcile its DOM. Read again, never insert again.
    // Two matching reads separated by a quiet interval are required per chunk.
    const settleInput=async expected=>{
      const {inputSettleMs,inputPollMs,inputStableMs}=this.inputTiming;
      const until=Date.now()+inputSettleMs;let matchedSince,last;
      do {
        abortReason(signal);last=await checkInput(expected);
        if(last.matched){matchedSince??=Date.now();if(Date.now()-matchedSince>=inputStableMs)return;}
        else matchedSince=undefined;
        if(Date.now()>=until)break;
        await delay(inputPollMs,signal);
      }while(true);
      throw inputFailure('input_mismatch',last,expected.length);
    };
    try {
      browser=await this.connect(config,signal);
      ({targetId}=await browser.send('Target.createTarget',{url:config.copilotUrl,background:false},undefined,signal));
      ({sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true},undefined,signal));
      const deadline=Date.now()+config.readyTimeoutMs;let state;
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
      if(state.nonempty || state.input.trim() || state.busy){
        assert((await evaluate('newChat')).clicked,'new_chat_required','空の会話を確保できません。既存の会話や入力欄は上書きしません。',409);
        const resetDeadline=Date.now()+15000;
        do {await delay(config.pollIntervalMs,signal);state=await evaluate('snapshot');if(state.editor&&!state.nonempty&&!state.input.trim()&&!state.busy)break;}while(Date.now()<resetDeadline);
      }
      assert(state.editor&&!state.nonempty&&!state.input.trim()&&!state.busy,'conversation_not_empty','会話の初期化を確認できません。送信を停止します。',409);
      let inserted='';
      while(inserted.length<request.prompt.length){
        abortReason(signal);
        const before=await checkInput(inserted);
        if(!before.matched)throw inputFailure('input_changed',before,inserted.length);
        assert((await evaluate('focus')).focused,'focus_failed','入力欄へフォーカスできません。',502);
        let end=Math.min(inserted.length+3000,request.prompt.length);
        if(end<request.prompt.length && /[\uD800-\uDBFF]/.test(request.prompt[end-1]))end--;
        const chunk=request.prompt.slice(inserted.length,end);
        // Input is not pasted through the user's clipboard; there is exactly one insertion per chunk.
        await browser.send('Input.insertText',{text:chunk},sessionId,signal,15000);inserted+=chunk;
        await settleInput(inserted);
      }
      await onBeforeSend();sent=true; // Conservative: the following click may succeed even if its result is lost.
      const clicked=await evaluate('send',{expected:request.prompt});
      if(clicked.input&&!clicked.input.matched)throw inputFailure('input_changed',clicked.input,request.prompt.length);
      assert(clicked.clicked,'send_unknown','送信クリックの結果が不明です。',502);
      let lastKey='',stableSince=Date.now(),lastError;
      while(true){
        abortReason(signal);await delay(config.pollIntervalMs,signal);
        state=await evaluate('snapshot');
        const key=JSON.stringify(state.candidates);
        if(key!==lastKey){lastKey=key;stableSince=Date.now();}
        if(state.busy || !state.nonempty || Date.now()-stableSince<config.stableMs)continue;
        // A strict assistant-only DOM selector is mandatory. No document.body fallback.
        for(const candidate of state.candidates){
          try{parseEnvelope(candidate,request);success=true;return candidate;}
          catch(error){lastError=error;}
        }
        throw new BridgeError('m365_response_invalid','生成が終了しましたが、完全なJSON・要求ID・ツール引数を検証できません。回答の修復や再送はしません。',502,
          {validation_code:lastError?.code??'invalid_json'});
      }
    } finally {
      // Only our owned request tab is stopped/closed. Never terminate Edge or touch other apps.
      if(browser&&sessionId&&sent&&!success){
        try{await evaluate('stop',{},AbortSignal.timeout(2000));}catch{}
      }
      if(browser&&targetId&&(success||signal?.aborted)){
        try{await browser.send('Target.closeTarget',{targetId},undefined,AbortSignal.timeout(2000),2000);}catch{}
      }
      // A non-cancelled failure tab remains visible for diagnosis/sign-in. Closing a tab does not delete M365 history.
      browser?.close();
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
