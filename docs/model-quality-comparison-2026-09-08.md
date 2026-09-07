# AutoとGPT 5.6 Think Deeperの同一課題比較

実M365画面で同じ51ツール定義・同じ要求を各1回実行した。Autoは新規タブのヘッダーが自動であることを送信前に確認。Think Deeperは製品の選択・正式名チェック・送信直前確認を使用。どちらも新規の会話であり前の回答は含めていない。

課題は依存なしのES moduleにsummarize/toCsvを作るcreate_file呼び出し要求。active=trueのみ、数量0/省略/小数、active負数拒否、任意カテゴリ名、原文保持、標準CSVの引用と改行を明示した。実ツールは実行せず、返されたコードを観測側で読んでから隔離した試験ディレクトリへ保存し、実行検査した。

| モード | 搬送全体 | モデル確認/選択 | 結果 |
|---|---:|---:|---|
| 自動 | 18536ms | 2ms | 初回合格 |
| GPT 5.6 Think Deeper | 19175ms | 680ms | 初回合格 |

厳密active判定、__proto__/constructor集計、0・小数・省略、負数拒否、CSV空入力、引用符/カンマ/CR/LF/CRLF、日本語/絵文字/HTML実体参照、凍結した入力の非破壊を検査。両方合格し、修正フィードバックは0回。

1課題各1回で精度差は観測しなかった。過去の失敗条件を今回明示したため、古い走行との違いをモデルだけの効果にしない。また今回の1回の生成は多段の継続作業・自律検証ループではない。Auto内部で選ばれた実モデルは不明。

証拠は.local/model-quality/{auto,think}.jsonと.mjs、verify.mjs、試験ドライバー.local/txt-attachment-trial/quality-compare.mjs。製品のThink Deeper選択設定は維持。全体実用化目標は継続中。
