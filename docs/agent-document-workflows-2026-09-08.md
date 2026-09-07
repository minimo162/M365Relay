# 主要エージェントの文書処理から取り入れる設計

調査範囲は公式資料、Anthropic公開document skills、このCodex環境にインストールされた文書スキル。製品の全バージョン・全実行環境が同じライブラリを使うとは主張しない。調査だけで他製品の処理を再現できたとも扱わない。

## 確認した方式

Anthropic公開DOCXスキルは新規作成にNodeのdocx、既存編集にOOXML操作、読取にpandoc、最終確認にLibreOffice変換とページ画像を使う。PPTXは新規にPptxGenJS、既存テンプレートはOOXML編集とスキーマ・リレーション検査。XLSXはopenpyxl/pandasに加えLibreOffice再計算を分離し、計算成功と業務上の正しい式を区別する。PDFはpypdf/pdfplumber/reportlabとCLIの組合せを案内する。Claude Code本体のファイル・シェルツールと追加document-skillsの違いに注意する。

Codex公式資料はpluginsにapps/skills/workflowsをまとめる構成を説明。この環境のローカルスキルでは、スプレッドシートとプレゼンテーションはJavaScriptのartifact-tool、文書/PDFはPython/OOXMLや描画用補助ツールも利用する。スプレッドシートは再計算とレンダリング、DOCX/PDFも画像化して目視する手順がある。この専用ランタイムがM365Relayへ再配布可能という意味ではない。

共通するのは「LLMにバイナリ文書を全部任せる」方式ではなく、形式別手順、文書処理エンジン、実行環境、読戻し・再計算・構造検証・描画確認の組合せ。新規生成と既存文書編集も分ける。長大な手順を毎回全部送る必要はなく、必要な形式の手順を参照する考え方が使える。

## M365Relayへの具体的反映方針

1. OfficeCLI/LiteParse等の版と実行パスを固定して配布し、モデルには簡潔な呼出契約を知らせる。形式別の詳細は必要時に読む。
2. 原本を保持して作業コピーへ変更し、保存されたファイルを再度読み込んで、対象箇所・数式・ページ数等を検証する。
3. OpenXML構造検査、数式が評価可能か、計算結果が業務条件を満たすか、表示が崩れないかを別の検査として記録する。
4. PDFはページ番号・座標付き原文と派生Markdownを分離する。抽出文字の存在だけで表の対応・読順が正しいと判断しない。
5. 表示検査には画像経路が必要。現在のRelayはvision=falseかつtext_onlyのため、モデルによる自動画像確認は未実装。今あるローカル構造検査をその代替の成功証拠にしない。
6. Pythonは既存スキルをそのまま使う場合には有用だが、設計上の必須条件ではない。Node+OfficeCLI+LiteParseで検証工程を満たせる範囲から評価する。

Anthropicのdocument skillsはsource-availableで、READMEはopen sourceと区別している。設計の参考にとどめ、コードやスキル一式を無条件に転載・同梱しない。Codex同梱の専用ツールも再配布可能とは仮定しない。

## Sources

- https://openai.com/index/codex-for-every-role-tool-workflow/
- https://github.com/anthropics/skills/blob/main/README.md
- https://github.com/anthropics/skills/blob/main/skills/docx/SKILL.md
- https://github.com/anthropics/skills/blob/main/skills/xlsx/SKILL.md
- https://github.com/anthropics/skills/blob/main/skills/pptx/SKILL.md
- https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md
- https://code.claude.com/docs/en/tools-reference
- Codex local primary-runtime skills version 26.905.11957: documents, spreadsheets, presentations, pdf. Local environment evidence, not a public universal implementation contract.
