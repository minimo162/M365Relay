import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));let count=0;
for(const dir of ['src','scripts','test','integration','vscode-bootstrap'])for(const file of await readdir(join(root,dir))){
  if(!file.endsWith('.mjs')&&!file.endsWith('.cjs'))continue;
  const r=spawnSync(process.execPath,['--check',join(root,dir,file)],{stdio:'inherit'});
  if(r.status!==0)process.exit(r.status??1);count++;
}
for(const file of ['package.json','config/settings.example.json','config/chatLanguageModels.example.json','config/node-runtime.lock.json'])JSON.parse(await readFile(join(root,file),'utf8'));
console.log(`Syntax checked ${count} JavaScript modules and 4 JSON files.`);
