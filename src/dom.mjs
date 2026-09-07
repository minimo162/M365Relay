// This function is stringified and evaluated in ONLY our own M365 tab.
// Page text is returned as data; it is never evaluated as JavaScript.
export function browserOperation(origin,selectors,operation,args={}) {
  if(location.origin!==origin)throw new Error('origin_mismatch');
  const docs=[document];
  function frames(d,depth){if(depth>3)return;for(const f of d.querySelectorAll('iframe'))try{const sub=f.contentDocument;if(sub&&sub.location.origin===origin&&!docs.includes(sub)){docs.push(sub);frames(sub,depth+1);}}catch{}}
  frames(document,0);
  const visible=e=>{if(!e)return false;const s=e.ownerDocument.defaultView.getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
  const find=list=>{
    for(const selector of list){const found=[...new Set(docs.flatMap(d=>Array.from(d.querySelectorAll(selector))).filter(visible))];if(found.length===1)return found[0];if(found.length>1)throw new Error('ambiguous_control');}
    return null;
  };
  const label=e=>(e.getAttribute('aria-label')||e.title||e.textContent||'').trim();
  function control(kind){
    const exact=find(selectors[kind]);if(exact)return exact;
    const regex={send:/^(送信|送信する|Send|Send message|Send prompt)(?:\s*\([^)]*\))?$/i,newChat:/^(新しいチャット|新規チャット|New chat|Start a new chat)$/i,stop:/^(停止|生成を停止|応答の生成を停止|Stop|Stop generating|Stop responding)$/i}[kind];
    const all=docs.flatMap(d=>Array.from(d.querySelectorAll('button,[role="button"]'))).filter(e=>visible(e)&&regex.test(label(e)));
    if(all.length>1)throw new Error('ambiguous_control');return all[0]??null;
  }
  const enabled=e=>e&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';
  const editor=find(selectors.editor);
  const read=e=>e?(typeof e.value==='string'?e.value:(e.innerText||e.textContent||'')):'';
  function replies(){
    for(const selector of selectors.assistant){
      const nodes=docs.flatMap(d=>Array.from(d.querySelectorAll(selector)));
      for(let i=nodes.length-1;i>=0;i--){
        const t=read(nodes[i]).trim();if(!t)continue;
        const code=[...nodes[i].querySelectorAll('pre code,pre')].map(e=>(e.textContent||'').trim()).filter(Boolean);
        return {candidates:[...new Set([...code,t])],nonempty:true};
      }
    }
    return {candidates:[],nonempty:false};
  }
  const normalize=t=>t.replace(/\r\n?/g,'\n').replace(/\n$/,'');
  if(operation==='snapshot')return {origin:location.origin,editor:!!editor,input:read(editor),busy:!!control('stop'),...replies()};
  if(operation==='focus'){
    if(!editor||!enabled(editor))throw new Error('editor_missing');editor.focus();
    if(editor.isContentEditable){const r=editor.ownerDocument.createRange();r.selectNodeContents(editor);r.collapse(false);const s=editor.ownerDocument.getSelection();s.removeAllRanges();s.addRange(r);}
    else if(editor.setSelectionRange)editor.setSelectionRange(editor.value.length,editor.value.length);
    return {focused:editor.ownerDocument.activeElement===editor};
  }
  if(operation==='send'){
    if(!editor||normalize(read(editor))!==normalize(args.expected))throw new Error('input_changed');
    if(control('stop'))throw new Error('already_generating');
    const button=control('send');if(!enabled(button))throw new Error('send_missing');
    button.click();return {clicked:true};
  }
  if(operation==='newChat'||operation==='stop'){
    const button=control(operation);if(!enabled(button))return {clicked:false};button.click();return {clicked:true};
  }
  throw new Error('unsupported_operation');
}
export function domExpression(config,operation,args) {
  return `(${browserOperation.toString()})(${JSON.stringify(config.origin)},${JSON.stringify(config.selectors)},${JSON.stringify(operation)},${JSON.stringify(args??{})})`;
}
