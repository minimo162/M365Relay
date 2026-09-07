import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {writeFile,stat} from 'node:fs/promises';
import {parsePdfPageRanges,pdfReadCoverage} from './pdf-result.mjs';

// Read-only document analysis. OCR must be a separately verified offline feature.
const args=process.argv.slice(2);
if(args.length<2||args.length>3){console.error('Usage: pdf-cli.mjs input.pdf output.json [pages: 1-5,8]');process.exitCode=1;}
else try{
 const [inputArg,outputArg,pages]=args,input=resolve(inputArg),output=resolve(outputArg);
 if(input.toLowerCase()===output.toLowerCase())throw Error('Input and output must differ.');
 if(!input.toLowerCase().endsWith('.pdf'))throw Error('This command accepts PDF only.');
 const ranges=parsePdfPageRanges(pages);
 if(!(await stat(input)).isFile())throw Error('Input is not a file.');
 const root=fileURLToPath(new URL('../',import.meta.url));
 const modulePath=join(root,'runtime','liteparse','node_modules','@llamaindex','liteparse','dist','lib.js');
 const {LiteParse}=await import(pathToFileURL(modulePath));
 const result=await new LiteParse({ocrEnabled:false,outputFormat:'markdown',keepHeadersFooters:true,preserveVerySmallText:true,quiet:true,...(pages?{targetPages:pages}:{})}).parse(input);
 const coverage=pdfReadCoverage(result,ranges);
 const out={schema:'m365-relay-pdf-v1',parser:'liteparse',parserVersion:'2.14.4',ocrEnabled:false,...coverage,
  totalPages:result.totalPages,pageErrors:result.pageErrors,markdown:result.text,
  notice:'Markdown is derived layout. Use per-page textItems and coordinates to verify table/value correspondence.',
  pages:result.pages.map(page=>({pageNum:page.pageNum,width:page.width,height:page.height,textItems:page.textItems}))};
 await writeFile(output,JSON.stringify(out,null,2)+'\n',{flag:'wx',encoding:'utf8'});
 console.log(JSON.stringify({output,pages:out.pages.length,totalPages:out.totalPages,ocrEnabled:false,...coverage}));
}catch(error){console.error('PDFの解析に失敗しました。原本は変更していません。');console.error(error.code==='EEXIST'?'出力先が存在します。別のファイル名を指定してください。':'入力PDF・ページ範囲・配布ファイルを確認してください。');process.exitCode=1;}
