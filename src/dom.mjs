import { DOM_REASONS, DOM_TAGS } from './diagnostics.mjs';
// This function is stringified and evaluated in ONLY our own M365 tab.
// Page text is returned as data; it is never evaluated as JavaScript.
export function browserOperation(origin,selectors,operation,args={}) {
  if(location.origin!==origin)throw new Error('origin_mismatch');
  const docs=[document];
  function frames(d,depth){if(depth>3)return;for(const f of d.querySelectorAll('iframe'))try{const sub=f.contentDocument;if(sub&&sub.location.origin===origin&&!docs.includes(sub)){docs.push(sub);frames(sub,depth+1);}}catch{}}
  frames(document,0);
  const visible=e=>{if(!e)return false;const s=e.ownerDocument.defaultView.getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
  const find=list=>{
    for(const selector of list){let matches;try{matches=docs.flatMap(d=>Array.from(d.querySelectorAll(selector)));}catch{throw new Error('invalid_selector');}const found=[...new Set(matches.filter(visible))];if(found.length===1)return found[0];if(found.length>1)throw new Error('ambiguous_control');}
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
  // innerText represents rendered layout: <p> boundaries and placeholder <br>s
  // introduce extra line breaks. textContent, in contrast, loses every boundary.
  // Read the plain-text editor DOM without either transformation. This reader is
  // deliberately separate from assistant Markdown extraction above/below.
  function editorText(e) {
    if (!e) return {text:'',reader:'missing'};
    if (typeof e.value === 'string') return {text:e.value,reader:'value'};
    if (!e.isContentEditable || !e.childNodes) throw new Error('unsupported_editor');
    const blocks=new Set(['P','DIV','PRE']);
    // Auto-linking changes markup, not the submitted characters. Read only the
    // anchor's text children; never read href, follow a link or alter the DOM.
    const inline=new Set(['A','SPAN','B','STRONG','I','EM','U','S','STRIKE','CODE','MARK','SUB','SUP']);
    let nodes=0;
    const fail=(reason,node)=>{const error=new Error(reason);error.bridgeTag=node?.tagName;throw error;};
    function plain(n,depth=0) {
      if(++nodes>100000||depth>64)throw new Error('editor_too_complex');
      if(n.nodeType===3)return n.nodeValue??'';
      if(n.nodeType===8)return '';
      if(n.nodeType!==1)fail('unsupported_editor_node',n);
      if(n.hidden)return '';
      if(n!==e&&n.getAttribute('aria-hidden')==='true') {
        return '';
      }
      if(n.tagName==='BR')return '\n';
      if(n!==e&&!blocks.has(n.tagName)&&!inline.has(n.tagName))fail('unsupported_editor_node',n);
      if(n!==e&&n.getAttribute('contenteditable')==='false'&&!inline.has(n.tagName))fail('nontext_editor_node',n);
      const cs=Array.from(n.childNodes).filter(x=>x.nodeType!==8);
      if((n===e||blocks.has(n.tagName))&&cs.length===1&&cs[0].nodeType===1&&cs[0].tagName==='BR')return '';
      const parts=[];let run='',inRun=false;
      for(const child of cs) {
        if(child.nodeType===1&&blocks.has(child.tagName)) {
          if(inRun){parts.push(run);run='';inRun=false;}
          parts.push(plain(child,depth+1));
        } else {run+=plain(child,depth+1);inRun=true;}
      }
      if(inRun)parts.push(run);
      return parts.join('\n');
    }
    return {text:plain(e),reader:'contenteditable-dom'};
  }
  function inputCheck(expected) {
    const current=editorText(editor),actual=normalize(current.text),want=normalize(expected);
    let i=0;while(i<actual.length&&i<want.length&&actual[i]===want[i])i++;
    const kind=(s,i)=>i>=s.length?'end':s[i]==='\n'?'line_break':s[i]==='\t'?'tab':s[i]===' '?'space':s[i]==='\u00a0'?'nbsp':'other';
    return {matched:actual===want,reader:current.reader,expected_chars:want.length,observed_chars:actual.length,
      first_difference:actual===want?null:i,expected_kind:actual===want?null:kind(want,i),observed_kind:actual===want?null:kind(actual,i)};
  }
  function replies(){
    for(const selector of selectors.assistant){
      const nodes=docs.flatMap(d=>Array.from(d.querySelectorAll(selector)));
      for(let i=nodes.length-1;i>=0;i--){
        const t=read(nodes[i]).trim();if(!t)continue;
        // M365's Scriptor renderer is not <pre><code>: line numbers are siblings
        // of indexed code lines. Read only those lines, in contiguous DOM order.
        // A virtualized prefix is not a complete answer. Require a transport end
        // marker, and never fall back to the rendered text with gutter labels.
        const indexed=[...nodes[i].querySelectorAll('[data-virtualized-code-find-root] [role="textbox"][aria-readonly="true"]')];
        if(indexed.length){
          const candidates=[];
          for(const box of indexed){
            const lines=[...box.querySelectorAll('[data-line-index]')];
            if(!lines.length||lines.some((line,index)=>line.getAttribute('data-line-index')!==String(index)))continue;
            const body=lines.map(line=>line.textContent??'').join('\n');
            const head=/^BRIDGE_(TOOL|FINAL_V2)\s+[a-f0-9-]{36}(?:\s|$)/i.exec(body);
            if(!head)continue;
            // Scriptor may append blank indexed rows (NBSP placeholders). They
            // are outside the terminal marker, not part of an argument value.
            const last=lines.findLast(line=>(line.textContent??'').trim());
            if((last?.textContent??'').trim().toUpperCase()!==`END_BRIDGE_${head[1].toUpperCase()}`)continue;
            candidates.push(body);
          }
          return {candidates:[...new Set(candidates)],nonempty:true};
        }
        const code=[...nodes[i].querySelectorAll('pre code,pre')].map(e=>(e.textContent||'').trim()).filter(Boolean);
        return {candidates:[...new Set([...code,t])],nonempty:true};
      }
    }
    return {candidates:[],nonempty:false};
  }
  const normalize=t=>t.replace(/\r\n?/g,'\n');
  if(operation==='snapshot')return {origin:location.origin,editor:!!editor,input:editorText(editor).text,busy:!!control('stop'),...replies()};
  if(operation==='verifyInput')return inputCheck(args.expected);
  if(operation==='sendReady'){
    if(!editor)return {ready:false,editor:false,busy:false,button:false,enabled:false};
    const checked=inputCheck(args.expected);
    const busy=!!control('stop');
    const button=control('send');
    return {ready:checked.matched&&!busy&&enabled(button),editor:true,busy,button:!!button,enabled:enabled(button),input:checked};
  }
  if(operation==='focus'){
    if(!editor||!enabled(editor))throw new Error('editor_missing');editor.focus();
    if(editor.isContentEditable){const r=editor.ownerDocument.createRange();r.selectNodeContents(editor);r.collapse(false);const s=editor.ownerDocument.getSelection();s.removeAllRanges();s.addRange(r);}
    else if(editor.setSelectionRange)editor.setSelectionRange(editor.value.length,editor.value.length);
    return {focused:editor.ownerDocument.activeElement===editor};
  }
  if(operation==='send'){
    if(!editor)throw new Error('editor_missing');
    const checked=inputCheck(args.expected);
    if(!checked.matched)return {clicked:false,input:checked};
    if(control('stop'))throw new Error('already_generating');
    const button=control('send');if(!enabled(button))throw new Error('send_missing');
    button.click();return {clicked:true};
  }
  if(operation==='newChat'||operation==='stop'){
    const button=control(operation);if(!enabled(button))return {clicked:false};button.click();return {clicked:true};
  }
  throw new Error('unsupported_operation');
}
export function guardedBrowserOperation(run,params,reasons,tags) {
  try{return run(...params);}
  catch(error){
    const reason=reasons.includes(error?.message)?error.message:'unknown_dom_exception';
    const tag=tags.includes(error?.bridgeTag)?error.bridgeTag:error?.bridgeTag?'OTHER':undefined;
    return {__m365_relay_dom_error__:{reason,...(tag?{tag}:{})}};
  }
}
export function domExpression(config,operation,args) {
  return `(${guardedBrowserOperation.toString()})(${browserOperation.toString()},${JSON.stringify([config.origin,config.selectors,operation,args??{}])},${JSON.stringify(DOM_REASONS)},${JSON.stringify(DOM_TAGS)})`;
}
