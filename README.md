# M365Relay

M365 Copilotの判断を、VS Codeの実行につなぐローカル接続アダプターです。

**0.2.0 / 実M365とVS Codeを接続した通し動作は未検証のプロトタイプです。**
プロンプト・アダプター・契約テストと、Node.js同梱のWindows配布処理を含みます。
Windowsでの配布テストと、M365の応答品質・社内端末での受入は別です。

## 役割

```text
VS Code Local / Agent（対話・標準ツール・承認）
  → POST /v1/chat/completions
  → M365Relay（会話・ツール定義をプロンプトへ変換）
  → 専用EdgeのM365 Copilot（次のツール名・引数をJSONで回答）
  → M365Relay（要求ID・JSON・引数を検証）
  → VS Code（tool_callsを実行し、結果を次の要求に載せる）
```

ツール名を固定せず、VS Codeが今回渡した定義を使います。1回答1ツールです。
業務ツールや実行ループは追加していません。MCP、PAD、Pi、OfficeCLI、Copilot SDKは使いません。
ブラウザー自動操作はアダプターの通信手段であり、VS Codeに公開する追加業務ツールではありません。
各要求を専用タブの新しい会話で処理し、VS Codeから受け取った履歴を毎回渡します。

## 利用者に必要なもの

Windows x64、Microsoft Edge、M365 Copilotに手動サインインできる組織アカウント、
Custom Endpoint / BYOKが使えるVS Code、これらと画面自動化の社内利用許可が必要です。
BYOKのサインイン不要とCustom Endpointは[VS Code公式資料](https://code.visualstudio.com/updates/v1_122)を参照してください。
GitHubアカウントやCopilot契約をアダプターの接続キーとして使いません。

**配布ZIPはNode.jsを同梱します。利用者のNodeインストール、npm install、PATH変更、管理者権限は不要です。**
初版の同梱対象はWindows x64のNode.js 22.23.2です。ARM64ネイティブ版は含みません。
起動時にダウンロードせず、同梱版が欠落・破損した場合は停止します。端末の別のNodeへフォールバックしません。
同梱ライセンスは`runtime/LICENSE`です。社内で実行許可が得られることまでは保証しません。

## 配布物の入手

リポジトリの **Actions → CI and Windows distribution → 成功したmainの実行 → Artifacts → M365Relay-windows-x64** から取得します。
ダウンロードしたArtifactsのZIPの中に、配布用`M365Relay-0.2.0-win-x64-<commit>.zip`と`.sha256`があります。
配布ZIPを社内へ持ち込み、チェックサムを照合して展開・共有してください。利用者はGitHubへ接続する必要がありません。

**GitHubのCode → Download ZIP / Source code (zip)はソースだけで、Node.jsを含みません。配布用には使わないでください。**
配布物の生成と検証の詳細は[配布手順](docs/distribution.md)を参照してください。

## 初回起動

業務ワークスペースとは別の場所に配布ZIPを展開します。フォルダー名に空白があっても構いません。

1. `Setup.cmd`を実行して設定と接続キーを作成します。
2. `Open-Copilot.cmd`で専用Edgeを開き、M365へ手動サインインします。
3. `Start-Bridge.cmd`を起動します。終了はそのウィンドウでCtrl+Cです。

生成先は`%LOCALAPPDATA%\M365Relay`です。設定・接続キー・要求台帳・専用Edgeプロファイルを、配布先へ書き戻しません。
`M365_RELAY_HOME`で保存先を変更できます。旧`M365_BRIDGE_HOME`も互換用に受け付けます。
旧版の`M365VSCodeBridge`から認証プロファイルを自動移行しません。既存データを利用する場合は保存先を明示してください。
`Setup.cmd`を繰り返しても既存設定・キーを上書きしません。

`token.txt`はこのPC内のHTTP接続用キーです。M365やGitHubのAPIキーではありません。
ログ・Git・共有フォルダー・業務ワークスペースへ入れないでください。
ブラウザー診断だけを行う場合は`Bridge.cmd diagnose`を実行します。

## VS Code接続

`Chat: Manage Language Models` → `Add Models` → `Custom Endpoint`でグループを追加します。
API種類は **Chat Completions**、キーは利用者ローカルの`token.txt`です。
初期化時に出力する`chatLanguageModels.example.json`を参照し、既存モデル設定を消さずに追加します。
ウィザードが生成した`${input:...}`のキー参照名を維持してください。

```json
{
  "id": "m365-copilot-ui",
  "name": "M365 Copilot (M365Relay)",
  "url": "http://127.0.0.1:8731/v1/chat/completions",
  "toolCalling": true,
  "vision": false,
  "maxInputTokens": 24000,
  "maxOutputTokens": 8000
}
```

数値は試作上の作業予算で、M365の公式トークン上限ではありません。
`maxPromptChars`を超えた入力は切り捨てず、送信前に拒否します。

通常のチャットで **Local / Agent** と **M365 Copilot (M365Relay)** を選び、まずVS Code標準の読取・検索・編集ツールだけを選択します。
ターミナルは必要な試験で追加します。MCP・外部ツール・別エージェントへの委譲は初回対象外です。
承認はVS Codeの既定確認を維持します。本アダプターは自動承認や組織ポリシーを変更しません。
補助モデル、履歴同期、他拡張の通信設定は別途確認してください。

## 最初の通しテスト

非機密のテスト用`sample.txt`を用意し、次を依頼します。

> sample.txtを読み、内容を3行で要約してsummary.mdに保存してください。保存後にsummary.mdを読み直して確認してください。

読む→判断→保存→再読取→観測結果に基づく完了をツール履歴と実ファイルで確認します。
M365が「保存しました」と答えるだけでは合格にしません。[受入条件](docs/acceptance.md)を参照してください。

## 制約

これはM365の公式APIではなく画面自動化です。DOMや応答形式の変更で停止する可能性があります。
テキスト専用で添付・画像・音声は未対応です。ファイル本文がツール結果に含まれれば、その本文もM365へ送信されます。
アダプター独自のログに本文は保存しませんが、M365・Edge・VS Codeの履歴には残り得ます。

JSONの重複キー、切断、未定義ツール、不正な引数は推測で修復しません。
JSON Schemaは主要制約の部分集合で、未対応制約を無視せず送信前に停止します。
M365が特殊文字のUnicodeエスケープを守るか、現在の画面で忠実に取得できるかは実機検証が必要です。

送信済み・結果不明の同一要求は自動再送せず409で止めます。別会話の同じ質問も止まる場合があります。
実行状況を確認して明示的な追加メッセージを送ってください。業務操作の厳密なexactly-once保証ではありません。
既存参考実装の実機成功を、本アダプターの成功証拠にはしていません。

## 開発・検証

開発者はNode.js 22.16以上で`node scripts/check.mjs`と`node --test`を実行できます。外部npm依存はありません。
`src/`が通信と変換、`prompts/m365-tool-router.md`がM365向けプロンプト、`test/`が模擬応答による契約テストです。
`scripts/Package-Release.ps1`は配布担当者/CI専用です。起動用CMDがこのスクリプトを呼ぶことはありません。
[設計](docs/architecture.md)・[検証範囲](docs/test-results.md)・[参照元](docs/sources.md)も参照してください。
