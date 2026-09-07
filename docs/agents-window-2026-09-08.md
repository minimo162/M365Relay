# Agents Windowと広いチャット画面

状態：partial。ユーザーは狭い通常チャットパネルの代わりにAgents Windowを希望。

VS Code 1.136.1のCLIで `--agents` が利用可能と確認し、M365Relayの専用ユーザーデータと実保存先のworkspaceを指定して起動した。
公式資料ではAgent HostのBYOKは `chat.agentHost.byokModels.enabled` で有効にする実験的機能と説明されている。

- [モデル設定](https://code.visualstudio.com/docs/agent-customization/language-models)
- [Agents Window](https://code.visualstudio.com/docs/agents/run/agents-window)

専用プロファイル内でBYOK用フラグと、認証済みの自前プロバイダーがある場合のsigned-out経路を試した。
Agents Windowの背後のモデル欄にはM365Relayが表示されたが、GitHub等へのサインイン画面が残った。
別サービスへのサインイン、契約追加、API送信は行っていない。M365RelayでのAgents Window実行成功とは扱わない。設定は検証用の専用プロファイルのみであり、配布の既定には追加していない。

ユーザーがすぐ広い画面で使える方法として、通常のVS Codeで **Chat: Move Chat into New Window** を実行し、独立チャットを最大化した。
実画面でM365Relayモデル、Local、Default permissionsを確認。これはAgents Windowではなく、通常チャットの表示場所を変えたもの。
この独立チャットから、実保存先の検証フォルダーで作業を再開した。追加の外部読取確認なしで複数のread_file実行を確認したが、課題全体の完走はまだ確認中。

Agents Windowのサインイン条件と実際のツールループ互換性は引き続き調査が必要。

## エディター領域の入力・送信確認

後続の独立窓3084684ではComputer Useの一括入力が反映されず、単一文字キーaは入力できた。制御キーも期待どおり反映されない場面があり、アプリ全体の入力不能ではなく自動操作経路の問題を含む。未送信aがその窓に残っている。一般の手入力の成否へ拡張しない。

親VS Code463226でChat: Move Chat into Editor Areaを実行し、通常チャットを中央の約760px幅領域へ移した。日本語の一括入力が表示され、Enterで送信し、指定した数字593817が応答として表示された。配布版サーバーの要求8516883fは110464文字、backend10260ms、success/final。追加のモデル契約なし。

READMEは実際に入力・応答を確認できたエディター領域の案内を先にした。これはAgents Windowではない。独立窓の自動入力問題とAgents Windowの認証条件は解決済みとは扱わない。
