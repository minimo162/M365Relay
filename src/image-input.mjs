import {createHash} from 'node:crypto';
import {assert} from './errors.mjs';
export const IMAGE_LIMITS=Object.freeze({count:4,bytes:4*1024*1024,totalBytes:12*1024*1024,pixels:16000000});

function dimensions(bytes,mime){
 if(mime==='image/png'){
  assert(bytes.length>=45&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'invalid_image','PNGデータを確認できません。');
  assert(bytes.readUInt32BE(8)===13&&bytes.toString('ascii',12,16)==='IHDR','invalid_image','PNGヘッダーが不正です。');
  let offset=8,hasData=false,ended=false;
  while(offset+12<=bytes.length){const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);assert(length<=bytes.length-offset-12,'invalid_image','PNGが途中で切れています。');offset+=length+12;if(type==='IDAT')hasData=true;if(type==='IEND'){assert(length===0,'invalid_image','PNG終端が不正です。');ended=true;break;}}
  assert(ended&&hasData&&offset===bytes.length,'invalid_image','PNGが完全ではありません。');
  return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
 }
 assert(bytes.length>4&&bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217,'invalid_image','JPEGデータを確認できません。');
 let offset=2;
 while(offset+4<=bytes.length){
  assert(bytes[offset++]===255,'invalid_image','JPEGマーカーが不正です。');
  while(bytes[offset]===255)offset++;
  const marker=bytes[offset++];if(marker===0xda||marker===0xd9)break;
  if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;
  assert(offset+2<=bytes.length,'invalid_image','JPEGが途中で切れています。');
  const size=bytes.readUInt16BE(offset);assert(size>=2&&offset+size<=bytes.length,'invalid_image','JPEGセグメントが不正です。');
  if([0xc0,0xc1,0xc2].includes(marker)){assert(size>=8,'invalid_image','JPEGフレームが不正です。');return [bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3)];}
  offset+=size;
 }
 assert(false,'invalid_image','対応するJPEGフレームがありません。');
}
export function decodeImagePart(part,{messageIndex,partIndex,role},images){
 assert(['user','tool'].includes(role),'invalid_image_role','画像は利用者の入力またはツール結果として渡してください。');
 const url=typeof part.image_url==='string'?part.image_url:part.image_url?.url;
 assert(typeof url==='string'&&url.length<=Math.ceil(IMAGE_LIMITS.bytes/3)*4+64,'image_too_large','画像は1枚4MiB以内です。',413);
 const match=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
 assert(match,'unsupported_image','画像はPNG/JPEGのdata URLのみ対応します。外部URLやファイルパスは取得しません。');
 const bytes=Buffer.from(match[2],'base64');
 assert(bytes.length>0&&bytes.length<=IMAGE_LIMITS.bytes&&bytes.toString('base64')===match[2],'invalid_image','画像のbase64データが不正です。');
 assert(images.length<IMAGE_LIMITS.count&&images.reduce((n,i)=>n+i.bytes.length,0)+bytes.length<=IMAGE_LIMITS.totalBytes,'image_limit','画像は4枚、合計12MiB以内です。',413);
 const [width,height]=dimensions(bytes,match[1]);
 assert(width>0&&height>0&&width*height<=IMAGE_LIMITS.pixels,'image_dimensions','画像の画素数が上限を超えています。',413);
 const sha256=createHash('sha256').update(bytes).digest('hex'),id=`image-${images.length+1}`;
 const fileName=`${id}-${sha256.slice(0,12)}.${match[1]==='image/png'?'png':'jpg'}`;
 images.push({id,fileName,mime:match[1],bytes,sha256,width,height,messageIndex,partIndex});
 return {type:'image_reference',id,fileName,sha256,mime:match[1],width,height};
}
