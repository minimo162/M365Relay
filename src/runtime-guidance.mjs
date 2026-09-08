// Version-pinned facts verified by verify-document-runtime.mjs, not execution authority.
export function runtimeGuidance(messages){
 const user=messages.findLast(m=>m.role==='user');
 const text=typeof user?.content==='string'?user.content:JSON.stringify(user?.content??'');
 if(!/Excel|エクセル|\.xlsx\b/i.test(text))return undefined;
 return {component:'OfficeCLI',version:'1.0.148',purpose:'verified basic syntax; filenames are examples to adapt to the user request',
  commands:[
   'create result.xlsx',
   'set result.xlsx /Sheet1/A1 --prop value=Sample',
   'set result.xlsx /Sheet1/B2 --prop value=1.5',
   'set result.xlsx /Sheet1/B3 --prop value=2',
   "set result.xlsx /Sheet1/B4 --prop 'formula=SUM(B2:B3)'",
   'get result.xlsx /Sheet1/B4 --json',
   'validate result.xlsx --json'
  ],
  notes:[
   'These are syntax examples, not source data or permission to use a tool. Use the user-requested filenames and actual source values. Create only a new output, never overwrite an existing workbook as a shortcut.',
   'Invoke these arguments through the bundled executable in $env:M365_RELAY_OFFICECLI. Quote each --prop argument in PowerShell when it contains parentheses, spaces, quotes or other special characters.',
   'A newly created xlsx has Sheet1. Numeric value arguments and SUM formulas were verified in the bundled version.',
   'These basic commands are already verified; do not reread broad help to rediscover them. Use narrow help only for additional properties or unfamiliar operations.',
   'Independent cell writes and their readback can be grouped into one terminal request. Check errors and preserve existing files.',
   'Validation confirms structure, not visual fidelity. Report display verification separately.'
  ]};
}
