import {randomUUID} from 'node:crypto';
import {open,link,unlink} from 'node:fs/promises';

export async function publishPdfOutput(output,serialized,signal){
 const temporary=`${output}.${randomUUID()}.tmp`;
 const file=await open(temporary,'wx');
 try{
  try{await file.writeFile(serialized,'utf8');}finally{await file.close();}
  if(signal?.aborted)throw Object.assign(Error('Cancelled'),{code:'PDF_CANCELLED'});
  // The complete local file becomes visible at once; link refuses existing targets.
  await link(temporary,output);
 }finally{await unlink(temporary).catch(()=>{});}
}
