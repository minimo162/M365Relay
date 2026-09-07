// Only fixed vocabulary / bounded counts may leave the browser or enter logs.
// Never copy exception descriptions, HTML, selectors, attributes, URLs or text.
export const DOM_REASONS = Object.freeze([
  'origin_mismatch','ambiguous_control','invalid_selector','unsupported_editor',
  'unsupported_editor_node','nontext_editor_node','editor_too_complex',
  'editor_missing','already_generating','send_missing','unsupported_operation',
  'unknown_dom_exception','missing_dom_result'
]);
export const DOM_OPERATIONS = Object.freeze(['snapshot','editorReady','verifyInput','focus','sendReady','send','newChat','stop']);
export const DOM_TAGS = Object.freeze([
  'A','P','DIV','PRE','BR','SPAN','B','STRONG','I','EM','U','S','STRIKE','CODE',
  'MARK','SUB','SUP','FONT','H1','H2','H3','H4','H5','H6','OL','UL','LI','BLOCKQUOTE',
  'IMG','SVG','IFRAME','INPUT','TEXTAREA','BUTTON','SELECT','OBJECT','VIDEO','AUDIO',
  'TABLE','TBODY','TR','TD','TH','HR','SCRIPT','STYLE','CANVAS','OTHER'
]);
export function safeDiagnostics(value) {
  if(!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out={};
  const enums={
    stage:['m365_dom','editor_input','send_ready','backend'], dom_operation:DOM_OPERATIONS, dom_reason:DOM_REASONS, dom_tag:DOM_TAGS,
    backend_phase:['connect','open_tab','attach_tab','wait_editor','reset_conversation','model_select','image_attach','editor_stable','input_before','input_focus','input_insert','input_settle','send_ready','before_send','send','response_wait','response_validate','cleanup'],
    reader:['missing','value','contenteditable-dom'],
    expected_kind:['end','line_break','tab','space','nbsp','other'],
    observed_kind:['end','line_break','tab','space','nbsp','other']
  };
  for(const [key,allowed] of Object.entries(enums)) if(allowed.includes(value[key]))out[key]=value[key];
  for(const key of ['expected_chars','observed_chars','first_difference','total_prompt_chars'])
    if(Number.isSafeInteger(value[key]) && value[key]>=0 && value[key]<=2000000)out[key]=value[key];
  if(typeof value.matched==='boolean')out.matched=value.matched;
  for(const key of ['button_found','button_enabled','busy'])if(typeof value[key]==='boolean')out[key]=value[key];
  return out;
}

