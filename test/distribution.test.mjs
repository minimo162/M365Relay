import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
test('runtime lock pins the official archive and extracted executable',async()=>{
  const p=JSON.parse(await read('config/node-runtime.lock.json'));
  assert.equal(p.version,'22.23.2'); assert.equal(p.arch,'x64');
  assert.equal(p.url,`https://nodejs.org/dist/v${p.version}/node-v${p.version}-win-x64.zip`);
  assert.match(p.sha256,/^[0-9a-f]{64}$/); assert.match(p.executableSha256,/^[0-9a-f]{64}$/);
  assert.notEqual(p.sha256,p.executableSha256);
});
test('launcher uses verified bundled runtime without PATH fallback or download',async()=>{
  const cmd=await read('Bridge.cmd'),ps=await read('scripts/Launch.ps1');
  assert.match(cmd,/SystemRoot/); assert.match(cmd,/NODE_OPTIONS=/); assert.match(cmd,/NODE_PATH=/);
  assert.doesNotMatch(cmd,/where node|^node\.exe/im);
  assert.match(ps,/Verify-Distribution/); assert.match(ps,/runtime\\node\.exe/);
  assert.doesNotMatch(cmd+ps,/Invoke-WebRequest|https:\/\/|Package-Release/);
});
test('packager verifies archive before extraction and checks executable version',async()=>{
  const s=await read('scripts/Package-Release.ps1');
  assert.ok(s.indexOf('Node.js archive SHA-256')<s.indexOf('ExtractToFile'));
  assert.match(s,/executableSha256/); assert.match(s,/actualVersion/);
  assert.match(s,/sourceRevision=\$revision/); assert.match(s,/--porcelain/);
});
test('distribution includes full license and does not copy user state',async()=>{
  const s=await read('scripts/Package-Release.ps1');
  assert.match(s,/@\('node.exe','LICENSE'\)/);
  assert.match(s,/\*\.example\.json/);
  assert.doesNotMatch(s,/Copy-Item[^\n]*(?:token\.txt|settings\.json|requests\.json|edge-profile)/);
  assert.match(s,/'Run\.cmd'/);
  assert.match(await read('Setup.cmd'),/Bridge\.cmd" setup/);
});
test('integrity verifier requires manifest and pinned node hash',async()=>{
  const s=await read('scripts/Verify-Distribution.ps1');
  assert.match(s,/Required manifest entry missing/); assert.match(s,/Get-FileHash/);
  assert.match(s,/executableSha256/); assert.match(s,/duplicate manifest path/);
});
test('Windows smoke test removes PATH Node and covers damaged bundles',async()=>{
  const s=await read('scripts/Test-Distribution.ps1');
  for(const marker of ['App with spaces','Missing bundled runtime was accepted','Corrupt application was accepted','Corrupt runtime was accepted','Repeated init changed']) assert.ok(s.includes(marker));
  assert.match(s,/definitely-invalid-inherited-option/);
  assert.match(s,/Corrupt runtime fixture/);
  assert.doesNotMatch(s,/\[IO\.File\]::Open\(\$node/);
});
