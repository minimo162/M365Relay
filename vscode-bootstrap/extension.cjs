const {promises: fs} = require('node:fs');
const path = require('node:path');

const enabled = vscode => vscode.workspace.getConfiguration('m365Relay').inspect('initializeFirstRun')?.globalValue === true;
const statusUrl = vscode => vscode.workspace.getConfiguration('m365Relay').get('statusUrl') || 'http://127.0.0.1:8731/health';

async function recordWorkspace(vscode) {
  const stateFile = process.env.M365_RELAY_WORKSPACE_STATE;
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
  if (!stateFile || !path.isAbsolute(stateFile) || typeof folder !== 'string' || !path.isAbsolute(folder)) return false;
  const value = JSON.stringify({version: 1, path: folder, updated_at: new Date().toISOString(), process_id: process.pid}) + '\n';
  await fs.mkdir(path.dirname(stateFile), {recursive: true});
  // The file is deliberately outside VS Code's profile/DB. A tiny direct
  // write is used as the Windows-compatible fallback when rename cannot
  // replace an existing file; the reader rejects partial JSON rather than
  // guessing a different workspace.
  const temporary = `${stateFile}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, value, {flag: 'wx', mode: 0o600});
  try {
    try {
      await fs.rename(temporary, stateFile);
    } catch (error) {
      if (!['EEXIST', 'EPERM', 'ENOTEMPTY'].includes(error?.code)) throw error;
      await fs.writeFile(stateFile, value, {flag: 'w', mode: 0o600});
      await fs.unlink(temporary).catch(() => {});
    }
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
  return true;
}

function installWorkspaceTracking(context, vscode) {
  const update = () => { recordWorkspace(vscode).catch(() => {}); };
  if (typeof vscode.workspace.onDidChangeWorkspaceFolders === 'function') {
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(update));
  }
  update();
}

async function fetchStatus(vscode) {
  try {
    const response = await fetch(statusUrl(vscode), {redirect: 'error'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch {
    return {server_state: 'stopped', m365_state: 'unknown', model_state: 'unknown'};
  }
}

function stateLabel(status) {
  if (status.server_state !== 'running') return '停止';
  if (status.m365_state === 'sign_in_required') return 'サインインが必要';
  if (status.m365_state === 'result_unconfirmed') return '結果未確認';
  if (status.model_state === 'unavailable') return 'モデルを確認できません';
  if (status.m365_state === 'available' && status.model_state === 'verified') return '利用可能';
  return '起動中';
}

function installStatus(context, vscode) {
  if (typeof vscode.window.createStatusBarItem !== 'function') return;
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment?.Left, 100);
  item.command = 'm365Relay.showStatus';
  item.tooltip = 'M365Relayの観測状態を表示';
  item.show();
  const refresh = async () => {
    const status = await fetchStatus(vscode);
    const label = stateLabel(status);
    item.text = `$(plug) M365Relay: ${label}`;
    item.tooltip = `M365Relay: ${label}\nサーバー: ${status.server_state ?? '不明'}\nM365: ${status.m365_state ?? '不明'}\nモデル: ${status.model_state ?? '不明'}`;
  };
  const timer = setInterval(refresh, 3000);
  timer.unref?.();
  context.subscriptions.push(item, {dispose: () => clearInterval(timer)});
  refresh();
}

async function prepare(context, vscode) {
  if (!enabled(vscode)) return false;
  // Record the attempt before any UI work. Restarting must not silently undo a
  // user's later decision to disable Copilot, including after a failed attempt.
  try {
    await context.globalState.update('attempted', true);
    await vscode.commands.executeCommand('workbench.action.chat.manage');
    const models = await vscode.lm.selectChatModels({vendor: 'customendpoint'});
    if (!models.some(model => model.id === 'm365-copilot-ui')) throw new Error('Model unavailable');
    await vscode.commands.executeCommand('workbench.action.chat.open');
    await vscode.commands.executeCommand('workbench.action.maximizeAuxiliaryBar');
    return true;
  } catch {
    await vscode.window.showWarningMessage('M365Relayの初回準備を完了できませんでした。コマンドパレットから「M365Relay: 接続モデルを準備」を実行してください。');
    return false;
  }
}

async function initialize(context, vscode) {
  context.subscriptions.push(vscode.commands.registerCommand('m365Relay.prepareModels', () => prepare(context, vscode)));
  context.subscriptions.push(vscode.commands.registerCommand('m365Relay.showStatus', async () => {
    const status = await fetchStatus(vscode);
    await vscode.window.showInformationMessage(`M365Relay: ${stateLabel(status)}（サーバー ${status.server_state ?? '不明'} / M365 ${status.m365_state ?? '不明'} / モデル ${status.model_state ?? '不明'}）`);
  }));
  installStatus(context, vscode);
  installWorkspaceTracking(context, vscode);
  if (!enabled(vscode) || context.globalState.get('attempted', false)) return false;
  return prepare(context, vscode);
}

exports.initialize = initialize;
exports.recordWorkspace = recordWorkspace;
exports.stateLabel = stateLabel;
exports.activate = context => initialize(context, require('vscode'));
