# OfficeCLIとNode/Python構成の比較

推奨候補を「Node.jsが全形式を直接処理」から「Node.jsで統括、OfficeCLIでOffice、PDFは専用ライブラリ」へ変更する。採用決定や配布への追加ではなく、現時点の比較判断。

| 候補 | 強み | 注意点・確認範囲 |
|---|---|---|
| OfficeCLI | DOCX/XLSX/PPTX共通のget/query/set/add/batch、JSON、OpenXML検証、内蔵数式計算 | 既存複雑文書の完全保持やExcelと全関数同一の挙動は未検証。PDFは別プラグイン等。画像化は外部ブラウザー |
| Nodeライブラリ群 | 既存Nodeで使え、コードによる専用処理を細かく組める。PDF.js/pdf-libも選べる | 形式ごとにAPIが異なる。ExcelJSは数式計算しない。候補PptxGenJS依存に未解消の監査指摘 |
| Pythonライブラリ群 | pdfplumber等のPDF解析・表抽出、既存Python資産 | Pythonと依存を追加管理。Officeレイアウトや数式の完全互換を自動的には解決しない |
| インストール済Microsoft Office | 実Officeの再計算・表示・PDF出力を使う候補 | デスクトップ版の存在と利用条件が必要。アプリ本体には同梱できない。COM/UI実行の運用設計が必要 |
| LibreOffice | headlessとconvert-toによる変換候補 | 別のOffice実行環境が必要。MS Officeとのレイアウト・数式互換は対象ファイルで検証が必要 |

## 確認した証拠

- OfficeCLIの現リリースv1.0.148 Windows x64をGitHub Releasesから取得。33419176bytes、公式asset digest df91e48fa250500b05ae1043777af26857e51ed12ea75b2f7a57e3333e3813bfと一致。--versionで1.0.148。グローバルinstallは実行していない。
- .NET10 self-contained/単体ファイルとして発行。ソースcsprojのPackageReferenceはOpenXMLとSystem.CommandLine。依存がゼロという意味ではない。ライセンスApache-2.0。Misenの現ローカル契約は1.0.147で、この試験版とは区別。
- 実CLIでXLSX作成、A1=1.5、A2=2、A3=SUM(A1:A2)を設定。get JSONのtext/cachedValue/computedValueが3.5、evaluated=true。validateはerrors空。
- ExcelJS4.4.0のWorkbookで同じ値・式を設定するとformulaは保持しresultは未設定。OfficeCLIの全数式互換を示すテストではない。
- OfficeCLIの2操作batchで、1件目のセル変更成功後に2件目を存在しないシート指定で失敗させた。atomicRolledBack=trueを返し、原本XLSXのSHA256が前後一致した。
- OfficeCLI HtmlScreenshot.csはブラウザーを内包せずPlaywright CLI/Chrome/Edge/Chromium/Firefoxを探索する。日本語組版・描画忠実度は未検証。
- Node候補はdocx9.7.1、exceljs4.4.0、pdf-lib1.17.1、pdfjs-dist6.3.289、pptxgenjs4.0.1。npm auditでuuidとimage-sizeの指摘。uuid11.1.1 override後もimage-size/PptxGenJSのhighが残る。document-runtimeは評価用で配布対象外。

## M365Relayへの候補構成

Node.jsで会話搬送・ファイル操作の呼出を統括し、OfficeCLIの版・SHA256・LICENSE/NOTICEを固定して自動更新本体へ同梱する。OfficeCLI自身のinstall/自己更新で個別環境を書き換えず、Relayの更新に統一する。M365へのモデル接続は引き続き画面操作。

PDF読取・結合・分割等はNodeのPDF.js/pdf-libを別に検証する。スキャンPDFのOCRや高度な表抽出は独立要件として判断。Pythonは現段階で必須とせず、具体的不足が確認された処理で再検討する。

次の採用ゲートは実DOCX/PPTX/XLSXの読取・編集・保存・描画比較、失敗時の原本保持、CLI JSON契約、既存のVS Code承認経路との統合。今回のCLI直接検査をM365からの通し動作の証拠にしない。

Sources: https://github.com/iOfficeAI/OfficeCLI/releases/tag/v1.0.148 、https://github.com/iOfficeAI/OfficeCLI/blob/v1.0.148/README.md 、https://github.com/iOfficeAI/OfficeCLI/blob/v1.0.148/src/officecli/Core/HtmlScreenshot.cs 、https://github.com/exceljs/exceljs 、https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html
