import { BridgeError, assert } from './errors.mjs';
/** JSON.parse semantics, except duplicate keys, non-finite numbers and excessive depth are rejected.
 * No repair, eval, YAML, trailing-comma removal, coercion or extraction from prose. */
export function strictJson(text, { maxBytes = 2 * 1024 * 1024, maxDepth = 64 } = {}) {
  assert(typeof text === 'string' && Buffer.byteLength(text) <= maxBytes, 'json_size', 'JSONのサイズが上限を超えています。', 413);
  let i = 0;
  const fail = () => { throw new BridgeError('invalid_json', '完全なJSONが必要です。重複キー・切断・構文の誤りは補修しません。'); };
  const ws = () => { while (i < text.length && /[\x20\t\r\n]/.test(text[i])) i++; };
  function string() {
    const start = i++;
    while (i < text.length) {
      const c = text[i++];
      if (c === '"') { try { return JSON.parse(text.slice(start, i)); } catch { fail(); } }
      if (c === '\\') i++;
    }
    fail();
  }
  function value(depth) {
    if (depth > maxDepth) fail(); ws(); const c = text[i];
    if (c === '"') return string();
    if (c === '{') {
      i++; ws(); const out = {}; const keys = new Set();
      if (text[i] === '}') { i++; return out; }
      for (;;) {
        ws(); if (text[i] !== '"') fail(); const key = string();
        if (keys.has(key)) fail(); keys.add(key); ws(); if (text[i++] !== ':') fail();
        const v = value(depth + 1);
        // defineProperty preserves JSON semantics even for a key named __proto__.
        Object.defineProperty(out, key, { value: v, enumerable: true, writable: true, configurable: true });
        ws(); const delim = text[i++]; if (delim === '}') return out; if (delim !== ',') fail();
      }
    }
    if (c === '[') {
      i++; ws(); const out = []; if (text[i] === ']') { i++; return out; }
      for (;;) { out.push(value(depth + 1)); ws(); const delim = text[i++]; if (delim === ']') return out; if (delim !== ',') fail(); }
    }
    for (const [token, v] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(token, i)) { i += token.length; return v; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (!number) fail(); i += number[0].length; const v = Number(number[0]);
    if (!Number.isFinite(v)) fail(); return v;
  }
  const out = value(0); ws(); if (i !== text.length) fail(); return out;
}
export const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export function exactKeys(object, required, optional = []) {
  return isObject(object) && required.every(k => Object.hasOwn(object, k)) &&
    Object.keys(object).every(k => required.includes(k) || optional.includes(k));
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
