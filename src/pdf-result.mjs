export function parsePdfPageRanges(value){
 if(value===undefined)return null;
 if(typeof value!=='string'||!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(value))throw new Error('Invalid page selection');
 return value.split(',').map(part=>{
  const [first,last=first]=part.split('-').map(Number);
  if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<1||last<first)throw new Error('Invalid page range');
  return {first,last};
 });
}
export function pdfReadCoverage(result,ranges){
 const total=result.totalPages;
 if(!Number.isSafeInteger(total)||total<0||!Array.isArray(result.pages))throw new Error('Invalid PDF result');
 if(ranges?.some(r=>r.last>total))throw new Error('Requested page is outside document');
 const intervals=(ranges??(total?[{first:1,last:total}]:[])).map(r=>({...r})).sort((a,b)=>a.first-b.first);
 const merged=[];
 for(const range of intervals){const previous=merged.at(-1);if(previous&&range.first<=previous.last+1)previous.last=Math.max(previous.last,range.last);else merged.push(range);}
 const expectedCount=merged.reduce((sum,r)=>sum+r.last-r.first+1,0);
 const actual=result.pages.map(p=>p.pageNum),observed=new Set(actual);
 const textless=result.pages.filter(p=>!p.textItems?.some(i=>typeof i.text==='string'&&i.text.trim())).map(p=>p.pageNum);
 const selectionComplete=actual.length===observed.size&&observed.size===expectedCount&&[...observed].every(n=>Number.isSafeInteger(n)&&merged.some(r=>n>=r.first&&n<=r.last))&&!(result.pageErrors?.length);
 const warnings=[];
 if(!selectionComplete)warnings.push({code:'page_selection_incomplete',expectedPages:expectedCount,parsedPages:actual.length});
 if(textless.length)warnings.push({code:'no_text_extracted',pages:textless,message:'No text was extracted. A page may be blank or require OCR; its content has not been verified.'});
 return {selectionComplete,parsedPageNumbers:actual,pagesWithoutText:textless,warnings};
}
