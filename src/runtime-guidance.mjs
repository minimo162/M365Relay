// Pinned Python runtime facts, not execution authority.
export function runtimeGuidance(messages){
 const user=messages.findLast(m=>m.role==='user');
 const text=typeof user?.content==='string'?user.content:JSON.stringify(user?.content??'');
 if(!/Excel|エクセル|Word|PowerPoint|PDF|\.xlsx\b|\.docx\b|\.pptx\b|資料|文書|教材|テキスト|内容を|概要|document|textbook|report contents/i.test(text))return undefined;
 return {component:'Python',version:'3.13.15',
  invocation:'& $env:M365_RELAY_PYTHON -I -B $env:M365_RELAY_DOCUMENTS <command> <arguments>',
  commands:['pdf-info input.pdf','pdf-text input.pdf --pages 1-5','pdf-read input.pdf output.json','pdf-render input.pdf output.png --page 1','xlsx-create draft.xlsx cells.json','xlsx-recalculate draft.xlsx result.xlsx','xlsx-read result.xlsx','office-pdf result.xlsx result.pdf','office-text input.docx','docx-create paragraphs.json result.docx','pptx-create slides.json result.pptx'],
  examples:{xlsx:{sheet:'Sheet1',cells:{A1:{value:'Sample'},B2:{value:1.5},B3:{value:2},B4:{formula:'SUM(B2:B3)'}}},docx:{paragraphs:['Title','Text']},pptx:{slides:[{title:'Title',paragraphs:['Text']}]}},
  notes:[
   'The initial workspace_info tree may omit binary files such as PDF. For an extensionless document name, first use file_search or list_dir to find originals before reading a same-named JSON; absence from the initial tree does not mean the PDF is absent. Prefer the original PDF over a same-named extraction JSON unless the user explicitly requests the JSON. Read pdf-info for the whole outline, then pdf-text for relevant pages. A partial extraction is not the entire document. Continue reading when the outline is incomplete and the original is accessible; do not stop merely because only the first pages are currently in context.',
   'Bundled libraries: openpyxl, pypdf, pypdfium2, Pillow. OfficeCLI and LiteParse are no longer bundled. Do not use their old environment variables or install packages at run time.',
   'Use create_file to write a Python script that reads source values directly and writes JSON with json.dump. Do not retype source strings or embed JSON/code inside PowerShell here-strings. Run scripts with the explicit bundled Python path.',
   'xlsx-create preserves strings, including leading zeros and formula-like literals. Formulas require a separate formula field. openpyxl does not calculate formulas. xlsx-read cached values can be absent or stale.',
   'xlsx-recalculate, office-pdf, docx-create and pptx-create require installed desktop Microsoft Office. They use its COM interfaces via Windows PowerShell without pywin32/lxml. If unavailable, report that limitation; never claim formulas or rendering were verified.',
   'All output names must be new. To recalculate into the final workbook, first create a separate draft. Never delete an existing output just to retry.',
   'pdf-read input.pdf output.json saves complete JSON exclusively; omit output.json to print it. Omit --pages for all pages; never guess the last page. Read the saved JSON directly from your Python script.',
   'PDF textItems are character boxes, not reconstructed table cells. Use page text together with coordinates and rendered images. OCR is not included.',
   'For visual verification, export Office to a new PDF, render required pages to PNG, then use view_image. Structural readback is not visual verification. JSON examples are syntax only; adapt data and filenames.'
  ]};
}
