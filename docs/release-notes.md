# M365Relay 0.2.2

0.2.0を基準に、0.2.1のVS Codeスキーマ互換修正と0.2.2の入力照合修正を累積で反映した版です。
配布ZIPはGitHub Actionsでコミット済みソースから生成し、Node.js 22.23.2 Windows x64と全文LICENSEを同梱します。
`release-manifest.json`の`sourceRevision`はビルド対象の実コミットです。利用者向けにはマージ後mainの成功したCIから取得してください。
ZIP名は`M365Relay-0.2.2-win-x64-<commit>.zip`です。

## 更新

旧版をCtrl+Cで停止し、新しいZIPを別フォルダーへ展開して`Start-Bridge.cmd`を起動します。
起動表示の0.2.2を確認してください。既存設定・token.txt・専用Edgeプロファイルは保持します。
Setupの再実行やAPIキー変更は不要です。M365_RELAY_HOME / M365_BRIDGE_HOMEの指定は従来と同じ値を使います。
途中まで入力された依頼は手動送信せず、その旧タブを閉じてください。

## 検証範囲

CIでLinux/Windowsの既存・追加スキーマテスト、実ブラウザーの模擬画面回帰テスト、
WindowsでPATHのNodeを除いた同梱Node配布試験を実行します。結果は対象コミットのActionsログで確認します。
設定・キーの再初期化時保持、配布文書と版・コミットの整合、欠落・破損時の停止も配布試験の対象です。
入力が欠けた場合は再挿入せず送信を停止し、本文を含まない診断のみを返します。

実ブラウザー試験はabout:blankの模擬入力欄・模擬回答を使用します。
実M365・VS Codeの通し動作、M365の入力上限・応答品質、社内端末での受入は未確認です。
詳細は[input-compatibility.md](input-compatibility.md)と[schema-compatibility.md](schema-compatibility.md)を参照してください。
