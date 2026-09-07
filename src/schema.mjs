import { assert, BridgeError } from './errors.mjs';
import { isObject, canonical } from './json.mjs';
// Explicit supported JSON Schema subset. Unknown validation keywords fail BEFORE sending.
// Annotation-only keywords do not constrain values; they are preserved in the prompt.
const ENUM_ANNOTATIONS = ['enumDescriptions','markdownEnumDescriptions','enumItemLabels'];
const ANNOTATIONS = new Set([...ENUM_ANNOTATIONS,'$schema','$id','$comment','title','description','markdownDescription','default','examples','deprecated','readOnly','writeOnly']);
const KEYS = new Set(['$ref','$defs','definitions','type','properties','required','additionalProperties','patternProperties','propertyNames',
  'minProperties','maxProperties','dependentRequired','dependentSchemas','dependencies','items','prefixItems','additionalItems','minItems','maxItems','uniqueItems',
  'contains','minContains','maxContains','minLength','maxLength','pattern','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf',
  'enum','const','allOf','anyOf','oneOf','not','if','then','else']);
const TYPES = new Set(['object','array','string','number','integer','boolean','null']);
const numKeys = ['minProperties','maxProperties','minItems','maxItems','minContains','maxContains','minLength','maxLength'];
const schemaMaps = ['properties','patternProperties','$defs','definitions','dependentSchemas'];
const schemaSingles = ['additionalProperties','propertyNames','additionalItems','contains','not','if','then','else'];
// Report only known schema vocabulary, never arbitrary keys, values, descriptions or examples.
const DIAGNOSTIC_KEYS = new Set([...KEYS, ...ANNOTATIONS, 'format', '$anchor', '$dynamicRef', '$dynamicAnchor',
  '$vocabulary', 'unevaluatedProperties', 'unevaluatedItems', 'contentEncoding', 'contentMediaType', 'contentSchema', 'nullable']);
function bad(keyword) {
  const label = typeof keyword === 'string' && DIAGNOSTIC_KEYS.has(keyword) ? keyword : 'unknown_or_invalid';
  throw new BridgeError('unsupported_schema', `未対応または不正なJSON Schemaです（項目: ${label}）。制約を無視せず送信前に停止しました。`,
    400, { schema_keyword: label });
}
function localRef(root, ref) {
  if (ref === '#') return root;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) bad();
  let out = root;
  for (const part of ref.slice(2).split('/')) {
    let key; try { key = decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~'); } catch { bad(); }
    if (!isObject(out) || !Object.hasOwn(out, key)) bad(); out = out[key];
  }
  return out;
}
function compileSupportedSchema(root) {
  const checked = new Set(); let count = 0;
  function inspect(s, depth = 0) {
    if (typeof s === 'boolean') return;
    if (!isObject(s) || depth > 48 || ++count > 10000) bad();
    if (checked.has(s)) return; checked.add(s);
    for (const key of Object.keys(s)) if (!KEYS.has(key) && !ANNOTATIONS.has(key)) bad(key);
    for (const key of ENUM_ANNOTATIONS) if (s[key] !== undefined && (!Array.isArray(s[key]) || s[key].some(x => typeof x !== 'string'))) bad(key);
    if (s.$schema !== undefined && !['http://json-schema.org/draft-07/schema#','https://json-schema.org/draft-07/schema',
      'https://json-schema.org/draft/2019-09/schema','https://json-schema.org/draft/2020-12/schema'].includes(s.$schema)) bad('$schema');
    // $id rebasing is deliberately not supported; local references always refer to this schema.
    if (s.$id !== undefined) bad('$id');
    if (s.$ref !== undefined) inspect(localRef(root, s.$ref), depth + 1);
    if (s.type !== undefined && !(Array.isArray(s.type) ? s.type.length > 0 && s.type.every(t => TYPES.has(t)) : TYPES.has(s.type))) bad();
    if (s.required !== undefined && (!Array.isArray(s.required) || s.required.some(x => typeof x !== 'string') || new Set(s.required).size !== s.required.length)) bad();
    if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length)) bad();
    for (const key of numKeys) if (s[key] !== undefined && (!Number.isInteger(s[key]) || s[key] < 0)) bad();
    for (const key of ['minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf']) {
      if (s[key] !== undefined && (typeof s[key] !== 'number' || !Number.isFinite(s[key]) || (key === 'multipleOf' && s[key] <= 0))) bad();
    }
    if (s.uniqueItems !== undefined && typeof s.uniqueItems !== 'boolean') bad();
    if (s.pattern !== undefined) { if (typeof s.pattern !== 'string' || s.pattern.length > 2048) bad(); try { new RegExp(s.pattern, 'u'); } catch { bad(); } }
    for (const key of schemaMaps) if (s[key] !== undefined) {
      if (!isObject(s[key])) bad();
      for (const [name, child] of Object.entries(s[key])) {
        if (key === 'patternProperties') { if (name.length > 2048) bad(); try { new RegExp(name, 'u'); } catch { bad(); } }
        inspect(child, depth + 1);
      }
    }
    for (const key of schemaSingles) if (s[key] !== undefined) inspect(s[key], depth + 1);
    for (const key of ['allOf','anyOf','oneOf','prefixItems']) if (s[key] !== undefined) {
      if (!Array.isArray(s[key]) || !s[key].length) bad(); for (const child of s[key]) inspect(child, depth + 1);
    }
    if (s.items !== undefined) {
      if (Array.isArray(s.items)) { if (s.prefixItems) bad(); for (const child of s.items) inspect(child, depth + 1); }
      else inspect(s.items, depth + 1);
    }
    for (const key of ['dependencies','dependentRequired']) if (s[key] !== undefined) {
      if (!isObject(s[key])) bad();
      for (const v of Object.values(s[key])) {
        if (Array.isArray(v)) { if (v.some(x => typeof x !== 'string')) bad(); }
        else if (key === 'dependentRequired') bad(); else inspect(v, depth + 1);
      }
    }
  }
  inspect(root);
  // draft-07 $ref ignores siblings; rejecting siblings avoids silently changing semantics.
  const oldDraft = !root?.$schema || String(root.$schema).includes('draft-07');
  if (oldDraft) for (const s of checked) if (s.$ref && Object.keys(s).some(k => k !== '$ref' && !ANNOTATIONS.has(k))) bad();
  function valid(s, v, depth) {
    if (depth > 64) return false;
    if (typeof s === 'boolean') return s;
    if (s.$ref && !valid(localRef(root, s.$ref), v, depth + 1)) return false;
    if (s.type !== undefined) {
      const match = t => t === 'object' ? isObject(v) : t === 'array' ? Array.isArray(v) : t === 'null' ? v === null :
        t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeof v === t;
      if (!(Array.isArray(s.type) ? s.type : [s.type]).some(match)) return false;
    }
    if (s.enum && !s.enum.some(x => canonical(x) === canonical(v))) return false;
    if (Object.hasOwn(s,'const') && canonical(s.const) !== canonical(v)) return false;
    if (s.allOf && !s.allOf.every(x => valid(x,v,depth+1))) return false;
    if (s.anyOf && !s.anyOf.some(x => valid(x,v,depth+1))) return false;
    if (s.oneOf && s.oneOf.filter(x => valid(x,v,depth+1)).length !== 1) return false;
    if (s.not !== undefined && valid(s.not,v,depth+1)) return false;
    if (s.if !== undefined) { const branch = valid(s.if,v,depth+1) ? s.then : s.else; if (branch !== undefined && !valid(branch,v,depth+1)) return false; }
    if (isObject(v)) {
      const keys = Object.keys(v);
      if (keys.length < (s.minProperties ?? 0) || keys.length > (s.maxProperties ?? Infinity)) return false;
      if (s.required && !s.required.every(k => Object.hasOwn(v,k))) return false;
      for (const key of keys) {
        if (s.propertyNames !== undefined && !valid(s.propertyNames,key,depth+1)) return false;
        let matched = false;
        if (s.properties && Object.hasOwn(s.properties,key)) { matched = true; if (!valid(s.properties[key],v[key],depth+1)) return false; }
        for (const [pattern, child] of Object.entries(s.patternProperties ?? {})) {
          if (new RegExp(pattern,'u').test(key)) { matched = true; if (!valid(child,v[key],depth+1)) return false; }
        }
        if (!matched && s.additionalProperties !== undefined && !valid(s.additionalProperties,v[key],depth+1)) return false;
      }
      for (const key of ['dependencies','dependentRequired','dependentSchemas']) for (const [name, dep] of Object.entries(s[key] ?? {})) {
        if (!Object.hasOwn(v,name)) continue;
        if (Array.isArray(dep) ? !dep.every(k=>Object.hasOwn(v,k)) : !valid(dep,v,depth+1)) return false;
      }
    }
    if (Array.isArray(v)) {
      if (v.length < (s.minItems ?? 0) || v.length > (s.maxItems ?? Infinity)) return false;
      if (s.uniqueItems && new Set(v.map(canonical)).size !== v.length) return false;
      const tuple = s.prefixItems ?? (Array.isArray(s.items) ? s.items : null);
      for (let i=0;i<v.length;i++) {
        const child = tuple ? (tuple[i] ?? (s.prefixItems ? s.items : s.additionalItems)) : s.items;
        if (child !== undefined && !valid(child,v[i],depth+1)) return false;
      }
      if (s.contains !== undefined) { const n = v.filter(x=>valid(s.contains,x,depth+1)).length; if (n < (s.minContains ?? 1) || n > (s.maxContains ?? Infinity)) return false; }
    }
    if (typeof v === 'string') {
      const n = [...v].length;
      if (n < (s.minLength ?? 0) || n > (s.maxLength ?? Infinity)) return false;
      if (s.pattern !== undefined && !new RegExp(s.pattern,'u').test(v)) return false;
    }
    if (typeof v === 'number') {
      if (v < (s.minimum ?? -Infinity) || v > (s.maximum ?? Infinity)) return false;
      if (s.exclusiveMinimum !== undefined && v <= s.exclusiveMinimum || s.exclusiveMaximum !== undefined && v >= s.exclusiveMaximum) return false;
      if (s.multipleOf !== undefined && Math.abs(v/s.multipleOf - Math.round(v/s.multipleOf)) > 1e-10) return false;
    }
    return true;
  }
  return value => valid(root, value, 0);
}

/** Add the source of an unsupported definition without serializing the schema itself. */
export function compileSchema(root, { toolName, source = 'schema' } = {}) {
  try { return compileSupportedSchema(root); }
  catch (error) {
    if (!(error instanceof BridgeError) || error.code !== 'unsupported_schema') throw error;
    const name = typeof toolName === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(toolName) ? toolName : undefined;
    const location = name ? `ツール「${name}」` : source === 'response_format' ? 'response_format' : 'schema';
    throw new BridgeError(error.code, `${location}: ${error.message}`, error.status, {
      ...error.details, schema_source: name ? 'tool' : source === 'response_format' ? 'response_format' : 'schema',
      ...(name ? { tool_name: name } : {})
    });
  }
}
