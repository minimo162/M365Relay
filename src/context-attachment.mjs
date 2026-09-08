import {createHash} from 'node:crypto';
import {assert} from './errors.mjs';

const textOf=m=>typeof m.content==='string'?m.content:Array.isArray(m.content)?m.content.filter(p=>p.type==='text').map(p=>p.text).join('\n'):'';
const ignored=new Set('the and with from this that tool result file text data read next context please use for not will only current instruction instructions'.split(' '));
// Bounded lexical retrieval, never a replacement for the complete snapshot.
export function selectContextEvidence(messages,fileName){
 const user=messages.findLast(m=>m.role==='user');
 const query=[user,...messages.filter(m=>m.role==='assistant').slice(-2)].filter(Boolean).map(textOf).map(s=>s.slice(0,2000)+'\n'+s.slice(-2000)).join('\n');
 const terms=[...new Set((query.match(/[A-Za-z][A-Za-z0-9_]{2,63}/g)??[]).map(s=>s.toLowerCase()).filter(s=>!ignored.has(s)))].slice(0,48);
 if(!terms.length)return [];
 const pattern=new RegExp('\\b(?:'+terms.join('|')+')\\b','gi');
 const hits=[];
 for(const [index,message] of messages.entries()){
  if(message.role!=='tool')continue;
  const parts=typeof message.content==='string'?[{part:null,text:message.content}]:Array.isArray(message.content)?message.content.map((p,part)=>({part,text:p.type==='text'?p.text:''})):[];
  for(const {part,text} of parts){
   const buckets=new Map();let scanned=0;
   for(const match of text.matchAll(pattern)){
    if(++scanned>100000)break;
    const key=match[0].toLowerCase(),bucket=buckets.get(key)??{count:0,positions:[]};bucket.count++;
    if(bucket.positions.length<8)bucket.positions.push(match.index);else bucket.positions[7]=match.index;
    buckets.set(key,bucket);
   }
   for(const [term,bucket] of buckets)for(const offset of bucket.positions)hits.push({index,part,text,offset,term,score:1/bucket.count});
  }
 }
 hits.sort((a,b)=>b.score-a.score||b.index-a.index||a.offset-b.offset);
 const selected=[];let remaining=6000;
 for(const hit of hits){
  if(selected.length>=12||remaining<100)break;
  let start=Math.max(0,hit.offset-180);
  const nextLine=hit.text.indexOf('\n',start);if(nextLine>=0&&nextLine<hit.offset)start=nextLine+1;
  let end=Math.min(hit.text.length,start+Math.min(700,remaining));
  if(start>0&&/[\uDC00-\uDFFF]/.test(hit.text[start]))start++;
  if(end<hit.text.length&&/[\uD800-\uDBFF]/.test(hit.text[end-1]))end--;
  if(selected.some(s=>s.message_index===hit.index&&s.content_part_index===hit.part&&start<s.end_offset&&end>s.start_offset))continue;
  const text=hit.text.slice(start,end);
  selected.push({fileName,message_index:hit.index,content_part_index:hit.part,role:'tool',start_offset:start,end_offset:end,offset_unit:'utf16_code_unit',
   start_line:hit.text.slice(0,start).split('\n').length,text,complete:false,selection:'keyword_excerpt'});
  remaining-=text.length;
 }
 return selected;
}

// Lossless, request-scoped transport snapshot. Never merge separate conversations.
export function prepareContextAttachment(payload,{maxBytes=4*1024*1024}={}){
 const indexed=payload.messages.map((message,index)=>({index,message}));
 const bytes=Buffer.from(JSON.stringify({protocol:payload.protocol,request_id:payload.request_id,messages:indexed},null,2)+'\n','utf8');
 assert(bytes.length<=maxBytes,'context_attachment_too_large','会話TXTが4MiBを超えました。履歴は切り捨てず送信前に停止しました。',413);
 const sha256=createHash('sha256').update(bytes).digest('hex'),fileName=`relay-context-${sha256.slice(0,12)}.txt`;
 let latestUser=-1;for(let i=payload.messages.length-1;i>=0;i--)if(payload.messages[i].role==='user'){latestUser=i;break;}
 const selected=new Set([latestUser,...payload.messages.map((m,i)=>['system','developer'].includes(m.role)?i:-1),...payload.messages.map((_,i)=>i).slice(-4)].filter(i=>i>=0));
 const latestSize=latestUser<0?0:JSON.stringify(payload.messages[latestUser]).length;
 const reservedLatest=latestSize<=32000?latestSize:0;
 let inlineRemaining=48000-reservedLatest;
 const messages=[...selected].sort((a,b)=>a-b).map(index=>{
  const message=payload.messages[index];
  const serialized=JSON.stringify(message);
  // An excerpt is an index entry, not a substitute for tool output or instructions.
  if(index===latestUser&&reservedLatest)return {index,complete:true,message};
  const limit=['system','developer'].includes(message.role)?32000:2000;
  if(serialized.length<=limit&&serialized.length<=inlineRemaining){inlineRemaining-=serialized.length;return {index,complete:true,message};}
  return {index,complete:false,role:message.role,tool_call_id:message.tool_call_id,original_chars:serialized.length,
      reference:{fileName,message_index:index},preview:serialized.slice(0,700),preview_is_not_complete:true};
 });
 return {attachment:{fileName,bytes},reference:{fileName,sha256,message_count:indexed.length,bytes:bytes.length},messages,evidence:selectContextEvidence(payload.messages,fileName)};
}
