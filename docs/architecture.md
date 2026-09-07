# 設計: 実行基盤ではなく接続アダプター

## 新リポジトリに分離する理由

Misen に VS Code 依存を足すのではなく、M365 UI を既存クライアントに接続する層を独立させる。
Misen/Pi、PAD、OfficeCLI の設計・リリース・回帰試験に影響を与えずに、接続の成立を検証できる。
将来 Misen から同じ Chat Completions 互換エンドポイントを使う設計は可能だが、本版では接続試験をしていない。

ここに置くのは、プロンプト、会話形式の変換、応答検証、M365との送受信、接続状態の管理だけ。
独自のチャットUI・業務特化ツール・業務ファイル操作API・エージェントループは置かない。
エージェントは VS Code、頭脳は M365、実際の手足は VS Code が提示・実行する標準ツール。

## 動的ツール契約

`tools[].function.name / description / parameters` を毎回そのままプロンプトに入れる。
テストコードにある `read_file` 等は与えたスキーマに対する試験用名称であり、製品の固定マッピングではない。
VS Code のバージョンによりツール名や引数が変わっても、対応するスキーマの範囲内なら変換側を直す必要はない。
実際のツールが「標準」か「拡張」かという出自は Chat Completions の定義だけでは保証できない。
初期構成は VS Code のツール選択で標準ツールだけにし、アダプターから追加のツールは登録しない。

M365 の返答:

```json
{
  "protocol": "m365-relay.v1",
  "request_id": "要求ごとにアダプターが作るUUID",
  "action": "tool_calls",
  "content": "利用者向けの短い説明",
  "tool_calls": [
    { "name": "今回提示されたツール名", "arguments": {} }
  ],
  "complete": true
}
```

`complete` は転送上のJSON完了マーカーであり、業務目的の達成ではない。
`final` もアシスタントの回答終了であって、成果物の実在・正しさをサーバーが認定するイベントではない。

完全なJSON → 重複キー検査 → 6フィールドの検査 → 要求ID → action/件数 → ツール名 → 引数の型・制約の順に検証。
コードフェンスは回答全体を囲む一組だけ許容する。地の文からの部分抽出・括弧の補完・型の強制変換はしない。
M365 の返答に tool call ID を作らせず、検証後にアダプターが新しい ID を付与する。

## 対応する API

| 項目 | 対応 |
|---|---|
| `GET /health` | 本文送信なしの起動確認。実機成功を示すものではない |
| `GET /v1/models` | ローカル接続キーが必要。モデルIDは1個 |
| `POST /v1/chat/completions` | テキストとfunction tools |
| streaming | SSE。待機中はコメント、検証後に完全なdeltaを送る |
| non-streaming | Chat Completion形式のJSON |
| `tool_choice` | auto / none / required / 特定function |
| `parallel_tool_calls` | 複数同時の呼び出しは返さず、毎回1件まで |
| `response_format` | text / json_object / 対応範囲のjson_schemaをfinalのcontentに検証 |
| `system/developer/user/assistant/tool` | roleとtool_call_idを保存。未対応の非テキスト要素は拒否 |
| `temperature/top_p/max_tokens/max_completion_tokens/reasoning_effort` | プロンプト上の参考値。UIの推論パラメーター制御ではない |
| usage / 課金情報 | 実測できないため返さない。ゼロトークン消費を捏造しない |
| Responses / Anthropic Messages / 音声 / 画像 / embeddings | 未対応 |

`m365-copilot-ui` は接続アダプターの名前であり、実際の基盤モデルの名称やバージョンではない。
M365 画面側で使われるモデルを利用する。自動モデル選択、基盤モデルの固定保証、別サービスへのフォールバックは実装していない。
M365 自身の内部検索・ツール利用はプロンプトで使わないよう指示するが、サービスの内部挙動を技術的に無効化できるAPIではない。

## JSON Schema の範囲

外部依存のない初版として、標準ツールで一般的な制約の部分集合を実装する。JSON Schema の全面準拠製品ではない。

対応: type、properties、required、additionalProperties、enum、const、allOf/anyOf/oneOf/not、if/then/else、配列items/prefixItems/contains/uniqueItems、数値・文字列・件数の上下限、pattern、patternProperties、propertyNames、dependencies/dependentRequired/dependentSchemas、同一スキーマ内の$ref/$defs/definitions。
注記用の title、description、markdownDescription、default、examples 等は保持するが、default を自動で補充しない。

未対応の制約・不正な制約は要求受信時にエラーにする。`format`、外部$ref、`$id`の再基準化、`unevaluatedProperties`等を黙って無視しない。
既定またはdraft-07の `$ref` と検証制約の混在は、意味の取り違えを避けるため拒否する。複雑なスキーマは追加試験が必要。
スキーマの完全な仕様適合性・標準ツール全種類での互換性・悪意ある複雑な正規表現に対する性能は未検証。
本格展開前に実 VS Code から観測したツール定義を固定フィクスチャとして追加すること。

## 送信・停止と失敗

1. localhostのみ待ち受け、ランダムBearerキーとHost検査。ブラウザー由来のOrigin付き要求を拒否。
2. 要求を直列化。待ち行列は最大4件で、待機中も停止が有効。
3. 入力の指紋をHMACで台帳へ記録。本文と回答は独自永続ファイルに保存しない。
4. EdgeのプロファイルとCDPポートを起動引数で照合。別プロファイルなら停止。
5. 自分で作ったタブだけに接続。過去の会話が復元された場合は新規チャットへ切り替え、空を確認する。
6. 入力はクリップボード不使用。3000文字単位で一度だけ挿入し、毎回入力結果を照合する。
7. 送信前に台帳へ記録して、送信ボタンを1回だけ押す。応答不明のクリックを再実行しない。
8. assistant専用セレクターの回答のみを読む。ページ全体やuser入力欄から回答を抽出しない。
9. 本文の安定、生成中表示の消失、IDと完全なJSONを確認する。表示・セレクター判定は実機検証が必要。
10. 正常時は所有タブを閉じる。非停止の失敗時は診断用に残す。停止時は所有タブだけに停止を試みて閉じる。

HTTP停止後に既に送信済みのM365推論・保存履歴を取り消せる保証はない。
VS Codeがすでに実行した業務ツールのロールバックは担当しない。停止したターミナル処理等の扱いはVS Code側で確認する。
台帳は exactly-once の業務実行保証ではなく、同一要求の自動再送・誤った応答再利用を避けるための保守的な制御。

## 初版に含めないもの

Office/PDFの業務ツール、PAD接続、MisenのUI、実行基盤の自作、社内SMB配布同期、自動更新、モデル最適化、画像添付、全社マルチユーザーサーバー、GitHubへのpush機能。
ターミナルツールを使う場面でも、このサーバーがコマンドを解釈・実行するのではなく、VS Codeが実行を管理する。
