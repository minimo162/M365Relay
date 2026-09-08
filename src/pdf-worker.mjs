import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parsePdfPageRanges,pdfReadCoverage} from './pdf-result.mjs';
try{
 const [input,pages]=process.argv.slice(2);
 const root=fileURLToPath(new URL('../',import.meta.url));
 const {LiteParse}=await import(pathToFileURL(join(root,'runtime','liteparse','node_modules','@llamaindex','liteparse','dist','lib.js')));
 const result=await new LiteParse({ocrEnabled:false,outputFormat:'markdown',keepHeadersFooters:true,preserveVerySmallText:true,quiet:true,...(pages?{targetPages:pages}:{})}).parse(input);
 const coverage=pdfReadCoverage(result,parsePdfPageRanges(pages));
 const out={schema:'m365-relay-pdf-v1',parser:'liteparse',parserVersion:'2.14.4',ocrEnabled:false,...coverage,
  totalPages:result.totalPages,pageErrors:result.pageErrors,markdown:result.text,
  notice:'Markdown is derived layout. Use per-page textItems and coordinates to verify table/value correspondence.',
  pages:result.pages.map(page=>({pageNum:page.pageNum,width:page.width,height:page.height,textItems:page.textItems}))};
 const serialized=JSON.stringify(out,null,2)+'\n';
 if(Buffer.byteLength(serialized)>32*1024*1024)throw Error('Output too large');
 if(!process.send)throw Error('IPC required');
 process.send(serialized,error=>process.exit(error?1:0));
}catch{process.exitCode=1;}
