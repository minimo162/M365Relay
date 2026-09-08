import {fork} from 'node:child_process';

// Native parser crashes and synchronous hangs must not disable the supervisor.
export function runPdfWorker(workerPath,args,{timeoutMs=120000,signal}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)throw Error('Invalid PDF timeout');
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(Object.assign(Error('PDF cancelled'),{code:'PDF_CANCELLED'}));return;}
  const child=fork(workerPath,args,{execArgv:[],stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,env:{...process.env,NODE_OPTIONS:'',NODE_PATH:''}});
  let result,failure,received=false;
  const fail=code=>{failure??=Object.assign(Error(code),{code});child.kill();};
  const timer=setTimeout(()=>fail('PDF_TIMEOUT'),timeoutMs);
  const abort=()=>fail('PDF_CANCELLED');signal?.addEventListener('abort',abort,{once:true});
  child.on('message',message=>{
   if(received||typeof message!=='string'||Buffer.byteLength(message)>32*1024*1024){fail('PDF_INVALID_RESULT');return;}
   received=true;result=message;
  });
  child.on('error',()=>{failure??=Object.assign(Error('PDF worker failed'),{code:'PDF_WORKER_FAILED'});});
  child.on('close',(code)=>{
   clearTimeout(timer);signal?.removeEventListener('abort',abort);
   if(failure)reject(failure);
   else if(code!==0||!received)reject(Object.assign(Error('PDF parser failed'),{code:'PDF_WORKER_FAILED'}));
   else resolve(result);
  });
 });
}
