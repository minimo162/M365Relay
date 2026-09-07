import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePdfPageRanges,pdfReadCoverage} from '../src/pdf-result.mjs';
test('PDF page ranges reject zero, reverse, unsafe and malformed values',()=>{
 for(const value of ['0','4-2','1,,3','9007199254740993','-1','1-'])assert.throws(()=>parsePdfPageRanges(value));
 assert.deepEqual(parsePdfPageRanges('1-3,8'),[{first:1,last:3},{first:8,last:8}]);
});
test('PDF coverage distinguishes blank/scanned pages and incomplete selections',()=>{
 const result={totalPages:3,pages:[{pageNum:1,textItems:[{text:'valid'}]},{pageNum:2,textItems:[]}],pageErrors:[]};
 const partial=pdfReadCoverage(result,null);
 assert.equal(partial.selectionComplete,false);assert.deepEqual(partial.pagesWithoutText,[2]);
 assert.deepEqual(partial.warnings.map(w=>w.code),['page_selection_incomplete','no_text_extracted']);
 const selected=pdfReadCoverage(result,parsePdfPageRanges('1-2'));
 assert.equal(selected.selectionComplete,true);assert.equal(selected.warnings[0].code,'no_text_extracted');
 assert.throws(()=>pdfReadCoverage(result,parsePdfPageRanges('4')));
});
test('duplicate or errored pages cannot satisfy requested coverage',()=>{
 const page={pageNum:1,textItems:[{text:'x'}]};
 assert.equal(pdfReadCoverage({totalPages:2,pages:[page,page]},null).selectionComplete,false);
 assert.equal(pdfReadCoverage({totalPages:1,pages:[page],pageErrors:['failed']},null).selectionComplete,false);
});
test('overlapping ranges count unique pages without expanding large ranges',()=>{
 const pages=[1,2,3].map(pageNum=>({pageNum,textItems:[{text:'x'}]}));
 assert.equal(pdfReadCoverage({totalPages:3,pages},parsePdfPageRanges('1-2,2-3')).selectionComplete,true);
 assert.equal(pdfReadCoverage({totalPages:1000000000,pages},null).warnings[0].expectedPages,1000000000);
});
