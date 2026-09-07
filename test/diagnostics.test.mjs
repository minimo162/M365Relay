import test from 'node:test';
import assert from 'node:assert/strict';
import {DOM_REASONS,DOM_TAGS,safeDiagnostics} from '../src/diagnostics.mjs';
import {guardedBrowserOperation} from '../src/dom.mjs';

test('diagnostics retain known DOM cause, operation, tag and bounded counts only',()=>{
  const safe={stage:'m365_dom',dom_operation:'verifyInput',dom_reason:'unsupported_editor_node',dom_tag:'IMG',expected_chars:3000,total_prompt_chars:85151};
  assert.deepEqual(safeDiagnostics({...safe,message:'SECRET',stack:'SECRET',html:'SECRET',href:'SECRET',selector:'SECRET',prompt:'SECRET',token:'SECRET'}),safe);
});
test('diagnostics reject unknown vocabulary, private tags and invalid counts',()=>{
  for(const bad of [undefined,null,[],false,'SECRET'])assert.deepEqual(safeDiagnostics(bad),{});
  assert.deepEqual(safeDiagnostics({stage:'SECRET',dom_operation:'SECRET',dom_reason:'SECRET',dom_tag:'PRIVATE-SECRET',reader:'SECRET',expected_kind:'SECRET',observed_kind:'SECRET',expected_chars:-1,observed_chars:Infinity,first_difference:1.5,total_prompt_chars:2000001,matched:'true'}),{});
  assert.deepEqual(safeDiagnostics({expected_chars:0,observed_chars:2000000,first_difference:null,matched:false}),{expected_chars:0,observed_chars:2000000,matched:false});
});
test('diagnostics retain input mismatch metadata without either input string',()=>{
  const safe={stage:'editor_input',reader:'contenteditable-dom',expected_chars:3000,observed_chars:2999,first_difference:10,expected_kind:'space',observed_kind:'nbsp',matched:false};
  assert.deepEqual(safeDiagnostics({...safe,expected:'SECRET-EXPECTED',observed:'SECRET-OBSERVED'}),safe);
});
test('guarded browser operation preserves normal values and arguments',()=>{
  const value={matched:true,expected_chars:3000};
  assert.equal(guardedBrowserOperation(x=>x,[value],DOM_REASONS,DOM_TAGS),value);
});
test('guarded browser operation only exports known reason and tag, never stack or attributes',()=>{
  const failure=()=>{const e=new Error('unsupported_editor_node');e.bridgeTag='IMG';e.html='SECRET';e.stack='SECRET';throw e;};
  assert.deepEqual(guardedBrowserOperation(failure,[],DOM_REASONS,DOM_TAGS),{__m365_relay_dom_error__:{reason:'unsupported_editor_node',tag:'IMG'}});
});
test('unexpected browser errors and custom tag names are redacted',()=>{
  const failure=()=>{const e=new Error('SECRET-TEXT');e.bridgeTag='PRIVATE-SECRET';throw e;};
  assert.deepEqual(guardedBrowserOperation(failure,[],DOM_REASONS,DOM_TAGS),{__m365_relay_dom_error__:{reason:'unknown_dom_exception',tag:'OTHER'}});
  assert.deepEqual(guardedBrowserOperation(()=>{throw 'SECRET';},[],DOM_REASONS,DOM_TAGS),{__m365_relay_dom_error__:{reason:'unknown_dom_exception'}});
});
