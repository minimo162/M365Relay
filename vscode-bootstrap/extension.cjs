const enabled = vscode => vscode.workspace.getConfiguration('m365Relay').inspect('initializeFirstRun')?.globalValue === true;

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
  if (!enabled(vscode) || context.globalState.get('attempted', false)) return false;
  return prepare(context, vscode);
}

exports.initialize = initialize;
exports.activate = context => initialize(context, require('vscode'));
