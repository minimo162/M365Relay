import {BridgeError,delay,abortReason} from './errors.mjs';

// Only fixed UI labels are used. Never derive selectors or code from page text.
export function modelOperation(origin,action){
 if(location.origin!==origin)return {ok:false};
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 const one=s=>{const all=[...document.querySelectorAll(s)].filter(visible);return all.length===1?all[0]:null;};
 const selector=one('button[aria-label="モデル セレクター"],button[aria-label="Model selector"]');
 const current=selector?.innerText.trim();
 if(action==='state')return {ready:!!selector,selected:current==='GPT 5.6 Think'||current==='GPT 5.6 Think Deeper'};
 if(action==='open'||action==='close'){if(!selector)return {ok:false};selector.click();return {ok:true};}
 const items=[...document.querySelectorAll('[role="menuitem"],[role="menuitemradio"]')].filter(visible);
 const text=action==='group'?'GPT\nOpenAI':'GPT 5.6 Think Deeper';
 const found=items.filter(e=>e.innerText.trim()===text||(action==='group'&&e.innerText.trim()==='GPT 5.6 Think Deeper\nOpenAI'));
 if(found.length!==1)return {ok:false};
 const item=found[0];
 if(action==='checked')return {ok:item.getAttribute('aria-checked')==='true'};
 if(item.getAttribute('aria-disabled')==='true'||item.disabled)return {ok:false};
 item.click();return {ok:true};
}

export async function selectThinkDeeper({browser,sessionId,config,signal,verifyOnly=false,evaluate,pollMs=100}){
 const fail=()=>new BridgeError('copilot_model_unavailable','GPT 5.6 Think Deeperの選択を確認できません。専用Copilotで利用可能なモデルを確認してください。自動モデルでは送信していません。',503);
 const run=evaluate??(async action=>{
  const r=await browser.send('Runtime.evaluate',{expression:`(${modelOperation.toString()})(${JSON.stringify(config.origin)},${JSON.stringify(action)})`,returnByValue:true,userGesture:true},sessionId,signal);
  if(r.exceptionDetails||!r.result?.value)throw fail();return r.result.value;
 });
 if(verifyOnly){if(!(await run('state')).selected)throw fail();return;}
 const until=Date.now()+config.readyTimeoutMs;
 const wait=async predicate=>{do{abortReason(signal);if(await predicate())return;await delay(pollMs,signal);}while(Date.now()<until);throw fail();};
 await wait(async()=> (await run('state')).ready);
 if(!(await run('open')).ok)throw fail();
 await wait(async()=> (await run('group')).ok);
 await wait(async()=> (await run('select')).ok);
 await wait(async()=> (await run('state')).selected);
 // Verify the full menu item as well as the abbreviated header.
 if(!(await run('open')).ok)throw fail();
 await wait(async()=> (await run('group')).ok);
 await wait(async()=> (await run('checked')).ok);
 if(!(await run('close')).ok)throw fail();
}
