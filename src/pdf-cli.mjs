import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stat,lstat} from 'node:fs/promises';
import {publishPdfOutput} from './pdf-output.mjs';
import {parsePdfPageRanges} from './pdf-result.mjs';
import {runPythonWorker} from './pdf-process.mjs';

const args=process.argv.slice(2);
if(args.length<2||args.length>3){console.error('Usage: pdf-cli.mjs input.pdf output.json [pages: 1-5,8]');process.exitCode=1;}
else {
 const controller=new AbortController(),cancel=()=>controller.abort();
 process.once('SIGINT',cancel);process.once('SIGTERM',cancel);

 try{
  const [inputArg,outputArg,pages]=args,input=resolve(inputArg),output=resolve(outputArg);
  if(input.toLowerCase()===output.toLowerCase())throw Error('Input and output must differ.');
  if(!input.toLowerCase().endsWith('.pdf'))throw Error('This command accepts PDF only.');
  parsePdfPageRanges(pages);
  if(!(await stat(input)).isFile())throw Error('Input is not a file.');
  try{await lstat(output);throw Object.assign(Error('Output exists'),{code:'EEXIST'});}catch(e){if(e.code!=='ENOENT')throw e;}
  const serialized=await runPythonWorker(fileURLToPath(new URL('../runtime/python/python.exe',import.meta.url)),fileURLToPath(new URL('../python/document_runtime.py',import.meta.url)),['pdf-read',input,...(pages?['--pages',pages]:[])],{signal:controller.signal});
  const out=JSON.parse(serialized);
  await publishPdfOutput(output,serialized,controller.signal);
  console.log(JSON.stringify({output,sourceFile:out.sourceFile,documentComplete:out.documentComplete,pages:out.pages.length,totalPages:out.totalPages,ocrEnabled:false,selectionComplete:out.selectionComplete,parsedPageNumbers:out.parsedPageNumbers,pagesWithoutText:out.pagesWithoutText,warnings:out.warnings}));
 }catch(error){
  console.error('PDFの解析に失敗しました。原本は変更していません。');
  console.error(error.code==='EEXIST'?'出力先が存在します。別のファイル名を指定してください。':error.code==='PDF_TIMEOUT'?'解析が120秒を超えました。ページ範囲を小さくして実行してください。':error.code==='PDF_CANCELLED'?'解析を中止しました。':error.code==='PDF_WORKER_FAILED'?'解析処理が異常終了しました。ページ範囲を小さくするか、別のPDFで確認してください。':'入力PDF・ページ範囲・配布ファイル・出力先を確認してください。');process.exitCode=1;
 }finally{
  process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
 }
}
