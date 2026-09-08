const enabled = vscode => vscode.workspace.getConfiguration('m365Relay').inspect('initializeFirstRun')?.globalValue === true;
const statusUrl = vscode => vscode.workspace.getConfiguration('m365Relay').get('statusUrl') || 'http://127.0.0.1:8731/health';

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
  if (!enabled(vscode) || context.globalState.get('attempted', false)) return false;
  return prepare(context, vscode);
}

exports.initialize = initialize;
exports.activate = context => initialize(context, require('vscode'));
