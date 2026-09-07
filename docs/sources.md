# 調査した仕様と参考実装

確認日: 2026-09-07。

## 公式の接続仕様

- VS Code 1.122 release notes: BYOK の GitHub サインイン不要と Custom Endpoint の Stable 対応。
  https://code.visualstudio.com/updates/v1_122
- VS Code language models: Custom Endpoint、chatLanguageModels.json、toolCalling、URL解決、utility models。
  https://code.visualstudio.com/docs/agent-customization/language-models
- VS Code Language Model Chat Provider API: 今回はこの独自拡張方式ではなくCustom Endpointを採用。
  https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider
- CDP Input domain: Input.insertText。
  https://chromedevtools.github.io/devtools-protocol/tot/Input/
- CDP Browser domain: Browser.getBrowserCommandLine と --enable-automation の関係。
  https://chromedevtools.github.io/devtools-protocol/tot/Browser/
- Node.js WebSocket: 標準WebSocketクライアント。
  https://nodejs.org/api/globals.html#class-websocket

## ユーザー所有の既存資産

- minimo162/PdfKoseiAssist
  `app/_app/src/CopilotClient.ps1`
  確認したblob SHA: `311a9f278458daaf80fb31832857b944c3d58960`
  参考: Input.insertTextによる入力、専用プロファイル、送信ボタン限定、assistant専用セレクター、空の末尾返信要素、Markdownによる文字欠落への注意。
  https://github.com/minimo162/PdfKoseiAssist/blob/main/app/_app/src/CopilotClient.ps1
- 同 `app/_app/src/Settings.ps1`
  確認したblob SHA: `f3917265f82ddebafcac225326625e89b75fed37`
  参考: M365 URL、入力欄セレクター。
  https://github.com/minimo162/PdfKoseiAssist/blob/main/app/_app/src/Settings.ps1
- minimo162/ai-prompts
  確認したmain: `b8c9ab8877791f89fcea24e86556df8549b597f1`
  参考: 要求ID、回答の完全性、重複キーの拒否、不明状態と自動再送の区別、汎用エージェントと特化処理の区別。
  https://github.com/minimo162/ai-prompts/tree/b8c9ab8877791f89fcea24e86556df8549b597f1

新しいNode/CDP実装として書き直しており、既存PowerShellドライバーをそのまま同梱・呼び出すものではない。
参考実装の実機成功や検証済み範囲は、このアダプターの成功・受入には流用していない。
既存リポジトリの内容は変更していない。
