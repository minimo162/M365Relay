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
