import { readFile, stat, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { strictJson, isObject } from './json.mjs';
import { assert, BridgeError } from './errors.mjs';

export const WORKSPACE_STATE_VERSION = 1;

export function workspaceStatePath(home) {
  return join(home, 'workspace-state.json');
}

function invalid(message='保存された作業フォルダー情報を確認できません。') {
  return new BridgeError('workspace_state_invalid', message, 409);
}

/**
 * Read only the dedicated M365Relay state file. The normal VS Code profile
 * and its databases are never inspected or modified. A missing file means a
 * first run; a malformed or removed remembered folder is an actionable stop,
 * not permission to guess another folder.
 */
export async function readRememberedWorkspace(path, {statPath=stat, resolveRealPath=realpath}={}) {
  let text;
  try { text = await readFile(path, 'utf8'); }
  catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw new BridgeError('workspace_state_unreadable', '前回の作業フォルダー情報を読み取れません。起動を停止しました。', 409,
      { reason: error?.code ?? 'read_failed' });
  }
  let value;
  try { value = strictJson(text, {maxBytes: 16384}); }
  catch { throw invalid(); }
  if (!isObject(value) || value.version !== WORKSPACE_STATE_VERSION ||
      typeof value.path !== 'string' || !value.path || !isAbsolute(value.path) ||
      Object.keys(value).some(key => !['version', 'path', 'updated_at', 'process_id'].includes(key)) ||
      (value.updated_at !== undefined && typeof value.updated_at !== 'string') ||
      (value.process_id !== undefined && !Number.isSafeInteger(value.process_id))) {
    throw invalid();
  }
  let isDirectory = false;
  try { isDirectory = (await statPath(value.path)).isDirectory(); } catch {}
  assert(isDirectory, 'workspace_not_found',
    '前回の作業フォルダーが見つかりません。起動ファイルに存在するフォルダーを指定してください。', 400,
    {source: 'remembered_workspace'});
  try { return await resolveRealPath(value.path); }
  catch { throw new BridgeError('workspace_not_found',
    '前回の作業フォルダーの実際の保存先を確認できません。起動ファイルに存在するフォルダーを指定してください。', 400,
    {source: 'remembered_workspace'}); }
}
