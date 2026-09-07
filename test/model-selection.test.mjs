import test from 'node:test';
import assert from 'node:assert/strict';
import {selectThinkDeeper} from '../src/model-selection.mjs';

test('selects and verifies full model item on each fresh request',async()=>{
 const actions=[];let selected=false;
 const evaluate=async action=>{
  actions.push(action);
  if(action==='state')return {ready:true,selected};
  if(action==='select')selected=true;
  return {ok:true};
 };
 const args={config:{readyTimeoutMs:100},evaluate,pollMs:1};
 await selectThinkDeeper(args);
 assert.deepEqual(actions,['state','open','group','select','state','open','group','checked','close']);
 await selectThinkDeeper({...args,verifyOnly:true});
 assert.equal(actions.at(-1),'state');
 selected=false;
 await assert.rejects(selectThinkDeeper({...args,verifyOnly:true}),{code:'copilot_model_unavailable'});
});

test('missing or unchecked requested model stops without fallback',async()=>{
 for(const failedAction of ['group','select','checked']){
  const actions=[];
  await assert.rejects(selectThinkDeeper({config:{readyTimeoutMs:10},pollMs:1,evaluate:async action=>{
   actions.push(action);return action==='state'?{ready:true,selected:true}:{ok:action!==failedAction};
  }}),{code:'copilot_model_unavailable'});
  assert(!actions.includes('close'));
 }
});
