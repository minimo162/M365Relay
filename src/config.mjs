import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { strictJson, exactKeys, isObject } from './json.mjs';
import { assert, BridgeError } from './errors.mjs';
export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export function homePath() { return resolve(process.env.M365_RELAY_HOME || process.env.M365_BRIDGE_HOME || join(process.env.LOCALAPPDATA || join(homedir(),'.local','share'),'M365Relay')); }
export async function initialize(home = homePath()) {
  await mkdir(home,{recursive:true,mode:0o700});
  for (const name of ['settings.json','token.txt']) {
    const content = name === 'settings.json' ? await readFile(join(ROOT,'config','settings.example.json'),'utf8') : randomBytes(32).toString('hex')+'\n';
    try { await writeFile(join(home,name),content,{flag:'wx',mode:0o600}); }
    catch(e) { if (e.code !== 'EEXIST') throw e; }
  }
  return home;
}
export async function loadConfig(home = homePath()) {
  await initialize(home);
  const c = strictJson(await readFile(join(home,'settings.json'),'utf8'));
  assert(exactKeys(c,['port','cdpPort','copilotUrl','maxPromptChars','requestTimeoutMs','readyTimeoutMs','pollIntervalMs','stableMs','maxQueue','selectors']), 'invalid_config', 'settings.json の項目を確認してください。');
  for (const key of ['port','cdpPort']) assert(Number.isInteger(c[key]) && c[key] >= 1024 && c[key] <= 65535, 'invalid_port','ポート番号は1024〜65535です。');
  assert(c.port !== c.cdpPort, 'invalid_port','HTTPとCDPには異なるポート番号が必要です。');
  const limits = {maxPromptChars:[1000,1000000],requestTimeoutMs:[10000,900000],readyTimeoutMs:[1000,120000],pollIntervalMs:[200,10000],stableMs:[1000,30000],maxQueue:[0,16]};
  for (const [k,[min,max]] of Object.entries(limits)) assert(Number.isInteger(c[k]) && c[k]>=min && c[k]<=max, 'invalid_config', `設定 ${k} が許容範囲外です。`);
  let url; try { url = new URL(c.copilotUrl); } catch { throw new BridgeError('invalid_url','M365のURLが不正です。'); }
  assert(url.protocol==='https:' && url.hostname==='m365.cloud.microsoft' && !url.port && !url.username && !url.password && !url.hash && !url.search && /^\/chat\/?$/.test(url.pathname), 'untrusted_url', '初版の送信先は https://m365.cloud.microsoft/chat/ のみに限定しています。');
  assert(exactKeys(c.selectors,['editor','assistant','send','newChat','stop']), 'invalid_selectors','セレクターの項目が不正です。');
  for(const v of Object.values(c.selectors)) assert(Array.isArray(v) && v.length>0 && v.length<=20 && v.every(x=>typeof x==='string' && x.length>0 && x.length<=512), 'invalid_selectors','セレクターは空でない文字列配列です。');
  const token=(await readFile(join(home,'token.txt'),'utf8')).trim();
  assert(/^[0-9a-f]{64}$/.test(token),'invalid_token','token.txt が不正です。');
  return {...c, token, home, profileDir:join(home,'edge-profile'), origin:url.origin};
}
