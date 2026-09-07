# M365Relay

M365 Copilotの判断を、VS Codeの実行につなぐローカル接続アダプターです。

**0.2.15 / 実VS Code＋実M365で通常会話の往復とVS Code標準ツールの呼び出し実行まで確認済みです。複数ツールラウンドの安定完走は継続検証中です。**

この版は0.2.2以降の実M365検証で見つかった入力欄DOM差分、長文入力、送信待機、応答形式、起動ロック、ツールループを累積修正しています。
既存の接続キーと設定を保持して利用します。[更新手順と検証範囲](docs/release-notes.md)を参照してください。
プロンプト・アダプター・契約テストと、Node.js同梱のWindows配布処理を含みます。

## 役割

```text
VS Code Local / Agent（対話・標準ツール・承認）
  → POST /v1/chat/completions
  → M365Relay（会話・ツール定義をプロンプトへ変換）
  → 専用EdgeのM365 Copilot（次のツール名・引数または最終回答を返す）
  → M365Relay（要求ID・ツール名・引数Schemaを検証）
  → VS Code（tool_callsを実行し、結果を次の要求に載せる）
```

ツール名を固定せず、VS Codeが今回渡した定義を使います。1回答1ツールです。
M365Relay自身は業務ツールを実行せず、VS Codeの標準ツール実行と承認を維持します。
各要求を専用タブの新しい会話で処理し、VS Codeから受け取った履歴を毎回渡します。

## 利用者に必要なもの

Windows x64、Microsoft Edge、M365 Copilotに手動サインインできる組織アカウント、Custom Endpoint / BYOKが使えるVS Code、これらと画面自動化の社内利用許可が必要です。
GitHubアカウントやCopilot契約をアダプターの接続キーとして使いません。

**配布ZIPはNode.jsを同梱します。利用者のNodeインストール、npm install、PATH変更、管理者権限は不要です。**
同梱対象はWindows x64のNode.js 22.23.2です。起動時にダウンロードせず、欠落・破損時は停止します。

## 配布物の入手

リポジトリの **Actions → CI and Windows distribution → 成功したmainの実行 → Artifacts → M365Relay-windows-x64** から取得します。
ダウンロードしたArtifactsのZIPの中に、配布用`M365Relay-0.2.15-win-x64-<commit>.zip`と`.sha256`があります。
GitHubのCode → Download ZIP / Source code (zip)はNode.jsを含まないため、利用者向け配布には使いません。

## 初回起動

1. `Setup.cmd`を実行して設定と接続キーを作成します。
2. `Open-Copilot.cmd`で専用Edgeを開き、M365へ手動サインインします。
3. `Start-Bridge.cmd`を起動します。終了はそのウィンドウでCtrl+Cです。

生成先は`%LOCALAPPDATA%\M365Relay`です。`M365_RELAY_HOME`で変更でき、旧`M365_BRIDGE_HOME`も互換用に受け付けます。
Setupを繰り返しても既存設定・`token.txt`・専用Edgeプロファイルは上書きしません。

PC再起動より前の`bridge.lock`が残っている場合は、OS起動時刻とロック作成時刻を比較して自動回収します。同一起動中の本物の二重起動は引き続き拒否します。

## VS Code接続

`Chat: Manage Language Models` → `Add Models` → `Custom Endpoint`で追加します。
API種類は **Chat Completions**、キーは利用者ローカルの`token.txt`です。

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

通常のチャットで **Local / Agent** と **M365 Copilot (M365Relay)** を選び、まずVS Code標準の読取・検索・編集ツールだけを選択します。
ターミナルは必要な試験で追加します。承認はVS Codeの既定確認を維持します。

## 0.2.15: 実M365互換性の累積修正

### 入力

実M365では、入力済み文字がリンクや`contenteditable=false`のSPANへ包まれたり、`aria-hidden`のミラー要素が混ざったりします。
0.2.15は表示上のラッパーと本文を区別して読み取り、依頼文が元と完全一致する場合だけ送信します。未知の非テキスト要素は引き続き拒否します。

長文は3,000文字ずつではなく、1回のCDP `Input.insertText`で入力します。Windowsクリップボードは変更しません。
入力後は再挿入せず全文一致を読み直し、送信ボタンが有効になるまで最大15秒待ちます。送信直前にも全文一致を再確認し、クリックは最大1回です。

詳細は[実M365 DOM互換性](docs/dom-compatibility.md)を参照してください。

### M365からVS Codeへの応答

M365はJSON内のWindowsパス、ターミナルコマンド、長い自然文を常に正しくエスケープするとは限らず、Markdown表示で`_`を`\_`へ変えたり、改行を空白へ畳み込む場合がありました。

そのため、ツール呼び出しは`BRIDGE_TOOL`、最終回答は`BRIDGE_FINAL`というテキスト搬送形式を優先します。
ツールの文字列引数はJSON文字列へ埋め込まず、そのまま受け取り、Relay側で元のVS Code JSON Schemaへ復元して厳格検証します。
制御語は通常の`_`とMarkdownエスケープされた`\_`の両方、空白区切りと改行区切りの両方を受け付けます。
旧JSON形式も後方互換として残し、明確なWindows絶対パスだけ限定的に`/`へ正規化します。

### ツールループ防止

同一ユーザー要求のツール履歴を数え、全ツールは最大12回、`run_in_terminal`は最大3回です。上限後の呼び出しは実行せず`tool_loop_detected`で停止します。
新しいユーザー要求ではカウンタをリセットします。

M365向けプロンプトにも、Python・pypdf・PyMuPDF・pdftotext等を存在前提にしないこと、失敗した同じ依存関係を言い換えて繰り返さないことを明記しています。
PDFを`read_file`した結果がバイナリだった場合、それだけで本文を読めたとは扱いません。

### 診断

DOM差分や内部例外は、本文やDOM全体を返さず、処理段階・既知の理由・要素種別・文字数などの安全なメタデータへ限定して返します。
想定外例外も単なるHTTP 500へ潰さず、バックエンド処理段階を付けたエラーへ変換します。

## 最初の通しテスト

非機密のテスト用`sample.txt`を用意し、次を依頼します。

> sample.txtを読み、内容を3行で要約してsummary.mdに保存してください。保存後にsummary.mdを読み直して確認してください。

読む→判断→保存→再読取→観測結果に基づく完了をツール履歴と実ファイルで確認します。

## 制約

これはM365の公式APIではなく画面自動化です。DOMや表示形式の変更で停止する可能性があります。
テキスト専用で添付・画像・音声は未対応です。ファイル本文がツール結果に含まれれば、その本文もM365へ送信されます。
アダプター独自のログに本文は保存しませんが、M365・Edge・VS Codeの履歴には残り得ます。

ツール引数はVS Codeから渡されたSchemaで検証し、未定義ツール・不正な引数を推測で実行しません。
送信済み・結果不明の同一要求は自動再送しません。業務操作の厳密なexactly-once保証ではありません。

PDF本文の抽出能力はVS Code側で利用可能なツールに依存します。M365RelayはPythonやPDFライブラリを同梱せず、勝手に外部ソフトをインストールしません。

## 開発・検証

開発者はNode.js 22.16以上で`node scripts/check.mjs`と`node --test`を実行できます。外部npm依存はありません。
`src/`が通信と変換、`prompts/m365-tool-router.md`がM365向けプロンプト、`test/`が契約テストです。
`scripts/Package-Release.ps1`は配布担当者/CI専用です。
