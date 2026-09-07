import {mkdtemp,mkdir,writeFile,unlink,rmdir,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {assert,delay,BridgeError} from './errors.mjs';

export function attachmentState(origin,names){
 if(location.origin!==origin)return {wrongOrigin:true};
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
 const labels=[...document.querySelectorAll('button[aria-label]')].filter(visible).map(e=>e.getAttribute('aria-label'));
 const attached=names.map(n=>labels.some(l=>l===`添付ファイル ${n} を削除する`||l===`Remove attachment ${n}`));
 const pending=[...document.querySelectorAll('[role="progressbar"]')].some(visible);
 const attachmentCount=labels.filter(l=>/^添付ファイル .* を削除する$/.test(l)||/^Remove attachment /.test(l)).length;
 return {dialog:dialogs.length>0,attached,pending,attachmentCount};
}
export async function attachRequestImages({browser,sessionId,config,images,signal,onBeforeUpload}){
 if(!images.length)return async()=>{};
 const base=join(config.home,'image-staging');await mkdir(base,{recursive:true});
 const directory=await mkdtemp(join(base,'request-')),written=[];
 const cleanup=async()=>{for(const path of written)await unlink(path).catch(()=>{});await rmdir(directory).catch(()=>{});};
 try{
  const paths=[];
  for(const image of images){
   assert(/^image-[1-4]-[0-9a-f]{12}\.(png|jpg)$/.test(image.fileName),'invalid_image_name','画像名が不正です。');
   const path=join(directory,image.fileName);await writeFile(path,image.bytes,{flag:'wx',mode:0o600});written.push(path);paths.push(await realpath(path));
  }
  const check=async()=>{
   const r=await browser.send('Runtime.evaluate',{expression:`(${attachmentState.toString()})(${JSON.stringify(config.origin)},${JSON.stringify(images.map(i=>i.fileName))})`,returnByValue:true},sessionId,signal);
   assert(!r.exceptionDetails&&r.result?.value&&!r.result.value.wrongOrigin,'image_attachment_changed','画像添付画面を確認できません。',502);
   assert(!r.result.value.dialog,'image_confirmation_required','専用Copilotの画像に関する初回確認を利用者が完了してください。',409);
   return r.result.value;
  };
  const before=await check();assert(before.attachmentCount===0,'image_attachment_changed','既存の添付があるため画像を追加しません。',409);
  const {root}=await browser.send('DOM.getDocument',{},sessionId,signal);
  const {nodeIds}=await browser.send('DOM.querySelectorAll',{nodeId:root.nodeId,selector:'input#upload-file-button[type="file"]'},sessionId,signal);
  assert(nodeIds?.length===1,'image_input_missing','画像の添付欄を一意に確認できません。',503);
  // Upload itself is an external side effect. Journal before the single call.
  await onBeforeUpload();
  await browser.send('DOM.setFileInputFiles',{nodeId:nodeIds[0],files:paths},sessionId,signal,30000);
  const deadline=Date.now()+config.readyTimeoutMs;let stableSince;
  do{
   const state=await check();
   if(state.attached.every(Boolean)&&state.attachmentCount===images.length&&!state.pending){stableSince??=Date.now();if(Date.now()-stableSince>=500)return {cleanup,verify:async()=>{const current=await check();assert(current.attached.every(Boolean)&&current.attachmentCount===images.length&&!current.pending,'image_attachment_changed','送信直前に画像の添付状態が変わりました。送信しません。',409);}};}else stableSince=undefined;
   await delay(100,signal);
  }while(Date.now()<deadline);
  throw new BridgeError('image_upload_unknown','画像の添付完了を確認できません。自動で再添付しません。',502);
 }catch(error){await cleanup();throw error;}
}
