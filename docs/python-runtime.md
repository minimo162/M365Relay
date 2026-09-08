# Python文書ランタイム（0.2.23候補）

利用者の社内環境の方針に合わせ、OfficeCLIとLiteParseを配布から外し、アプリ内のPythonと必要なライブラリへ移行する。接続サーバーのNode.jsは維持する。PythonはOSへインストールせず、レジストリ・通常のPATH・既存Python環境を変更しない。

## 同梱構成

- CPython 3.13.15 Windows x64 embeddable: 公式ZIPとpython.exeをSHA256固定。
- openpyxl 3.1.5 / et_xmlfile 2.0.0: Excel作成・読取。
- pypdf 6.18.0: PDFの分割・結合などのPython API。
- pypdfium2 5.13.0: PDF文字と座標、ページ描画。
- Pillow 12.3.0: 一般画像の読書き、切抜き、リサイズ、文字描画。任意のAVIFコーデックは除外。
- PNG出力: Python標準のzlib/structで符号化する。PDFiumが描画した画素を使うため、Pillowや別の画像コーデックDLLは不要。

pip、Tcl/Tk、pandas、NumPy、OCRエンジン、OfficeCLI、LiteParseは入れない。Python標準ランタイムは削らず、`_pth`で同梱パッケージのみを参照する。実行は`-I -B`を使う。ライブラリのバージョン・公式配布URL・SHA256はconfig/python-runtime.lock.jsonに記録し、wheelのライセンスとdist-infoを保持する。ライブラリ導入にpipやsetup.pyの実行は不要で、固定wheelをビルド時に展開する。

4パッケージの最小候補は展開後31,835,839 bytesだった。その後、利用者が社内リストにopenpyxl/python-pptx/Pillowの記載を確認したため、画像処理の実用性を優先してPillowを再追加した。現在は5パッケージで、PDFのPNG出力自体は標準符号化を維持する。以前の48.8MBというZIP実測はPillow再追加前の候補の値である。

## Officeの扱い

openpyxlは数式を保存するが計算しない。数式の再計算・Officeと同じ描画・Word/PowerPointの作成は、端末にあるデスクトップ版Microsoft OfficeをWindows PowerShell COMで利用する。Office自体、pywin32、lxmlは同梱しない。

この端末ではpython-docx/python-pptxの依存lxml DLLがWindowsのアプリ制御に拒否されたため、採用を取りやめた。制御は解除していない。PDFiumの必要なモジュールはこの端末で読み込めたが、これだけで会社の承認済みとは判断しない。ネイティブDLLは残るのでTHIRD_PARTY.mdと固定依存一覧を社内確認に使用する。

追加調査でCodeIntegrityイベント3077がlxmlのetree.cp313-win_amd64.pydをコード署名ポリシーで拒否したことを確認した。会社の一覧にないことが原因とは判断しない。2026-09-08の利用者の決定により、python-pptxは同梱しない方針とする。lxmlの解消は公開の前提条件にしない。PowerPointの作成・PDF出力はインストール済みデスクトップ版Officeを利用する。別の場所へコピーしたり制御を解除して回避したりはしない。Pillowは同梱候補でPNG/JPEG保存・読取・切抜き・拡縮・文字描画を確認済み。

Officeヘルパーは新しい出力のみを生成し、入力は読取専用で開く。自分で起動したOfficeのPIDと開始時刻を記録して終了処理を限定する。既存のOfficeプロセスが再利用された場合は停止する。PowerPointが既に起動している場合などにこの制約へ当たり得る。Officeのない端末でもPDF処理とExcelファイルの読書きは利用できるが、数式再計算・Office描画・Word/PowerPoint作成は使用できない。

## コマンド

PowerShellでは以下の形式で呼ぶ。新しい端末セッションで環境変数が反映される。

```powershell
& $env:M365_RELAY_PYTHON -I -B $env:M365_RELAY_DOCUMENTS --help
```

- `pdf-read input.pdf --pages 1-3`: JSONを標準出力。従来のNode側pdf-cliもこのPython処理を利用し、新しいJSONファイルへ排他的に保存する。
- `pdf-render input.pdf output.png --page 1`: PNG生成。
- `xlsx-create draft.xlsx cells.json`: 原文の文字列を保存。式だけは`formula`フィールドで指定。
- `xlsx-recalculate draft.xlsx result.xlsx`: インストール済みExcelで計算し別ファイルへ保存。
- `xlsx-read result.xlsx`: 数式・値・キャッシュを区別して読取。
- `office-pdf input.xlsx output.pdf`: OfficeでPDF出力。docx/pptxにも対応。
- `docx-create paragraphs.json result.docx` / `pptx-create slides.json result.pptx`: インストール済みOfficeで作成。
- `office-text input.docx`: 本文/スライド段落のテキストのみ。ヘッダー・ノート・画像・埋込オブジェクトは読取対象外と明示する。

PDFのtextItemsは文字単位の座標で、表構造を推測しない。派生テキストはPDFiumの読取順であり、以前のLiteParseによるMarkdown表とは異なる。スキャンページを文字抽出済みとは報告しない。

## 検証状況

埋め込みPythonでPDF文字/座標/描画、Excel作成・文字列保持・インストール済みExcelによるSUM再計算、Word/PowerPoint作成・読戻し・PDF出力を実行。3形式の描画PNGを目視確認した。初期のWord HWND取得失敗を修正し、残った試験用プロセスを終了した。これは文書コマンドの局所試験で、Python版の実M365エージェントによる全工程はまだ未検証。

参照: [Python埋め込み版](https://docs.python.org/3.13/using/windows.html#windows-embeddable)、[Python 3.13.15配布とハッシュ](https://www.python.org/downloads/release/python-31315/)、[pypdfium2 API](https://pypdfium2.readthedocs.io/en/stable/python_api.html)、[openpyxlの数式制約](https://openpyxl.readthedocs.io/en/stable/simple_formulae.html)。

## 配布と実VS Codeの追加結果

0674308候補ZIPは48,847,195 bytes。旧0.2.22の57,357,655 bytesから約15%縮小し、OfficeCLI/LiteParseのruntime項目は0。165単体テストとWindows配布10検査が成功し、CIも全ジョブ成功。Pythonを欠いた配布が外部Pythonへフォールバックしないことも検査した。

同梱Node/Pythonを使う独立した専用VS Codeプロファイルから、実M365に固定1ページPDF→Excel課題を依頼。5要求・Relayエラー0・約114.5秒で、PDF読取、Excel作成、Office再計算、読戻し、PDF/PNG生成まで進んだ。独立した読戻しで品目・数値・SUM式・注記が一致し、原本を含む既存2ファイルはハッシュ不変。ただしモデルはview_imageを呼ぶ前に最終回答したため、無介入完走とはしない。追加の画像閲覧依頼は画面操作の競合で送信を確認できず、未実施として残す。

利用対象の社内PCにデスクトップ版Officeがあるかは利用者へ確認中。ローカル端末には3アプリが存在して実処理できたが、社内端末にも同じ前提が成立するとは推定しない。正式公開はまだ行っていない。

保存前の入力検証も追加した。openpyxlが32,768文字を32,767文字へ切り詰める挙動を実測し、候補側ではUTF-16換算32,767単位を超えるセル文字列を拒否する。JSON内の重複キー、値/数式の同時指定、範囲指定やシート外アドレス、非有限数値、未知のフィールドも拒否する。長い内容を自動で短縮・分割せず、元データを保持したまま明示的な処理を求める。

5ea62e5の配布候補で、生成済みPNGを新規の実VS Codeチャットから読む追加試験を実施。copilot_viewImage完了、実M365の最終回答、2要求・約36.9秒・Relayエラー0を確認。列見出しと合計2.5/41.5、文字としての`&gt;`を認識した。注記の引用符は画像回答で曲がった形に転記されていたため、文字単位の一致は既に確認したExcel読戻しを根拠とする。7ファイルはハッシュ不変。これは別の読取試験であり、前の複合依頼を無介入成功へ変更するものではない。試験用ウィンドウと接続プロセスは終了した。

既存PowerPointを保全する手動試験も実施した（test/office-existing-process.ps1）。試験側で起動したPowerPointと保存済み文書を残して文書ヘルパーを呼ぶと、再利用を検出して作成処理を拒否し、既存プレゼンテーション・内容・設定・ファイルハッシュを維持した。拒否された出力は作成されなかった。これはインストール済みOfficeでの実機試験であり、OfficeのないCIでは構文確認のみを行う。

PowerPoint本文読取はpresentation.xmlのスライド一覧とrelationshipsで順序を解決します。内部ファイル名順では、並べ替えたスライドや参照されない残存パーツを誤って読むことを合成ZIPで再現したため修正しました。表示順2→1を保持し、参照されない3を除外する回帰試験と、Officeで生成した実PPTXの読戻しを確認しています。


pdf-read input.pdf output.jsonは完全な抽出結果を新規UTF-8 JSONへ排他的に保存し、標準出力には保存先とページ情報だけを返します。出力引数を省略すると従来どおり全文JSONを標準出力へ返します。--pages省略時は全ページです。ページ範囲エラーや既存出力の場合はファイルを上書き・空ファイル化しません。後続スクリプトは保存したJSONから原文を直接読み取れます。

## JSON保存対応後の実VS Code試験

2026-09-08、dd8fd15配布候補の専用VS Codeから固定1ページPDFの転記を依頼し、追加助言なしで読取→Excel作成→読戻し→OfficeによるPDF化→PNG生成→view_image→最終回答まで到達。8要求・168,981ms・Relayエラー0、既存19ファイルのSHA256不変。品目・数値・SUM式・末尾注記は独立した読戻しで一致し、観測者もPNG上の合計2.5/41.5を確認した。

保存されたXLSXの数式キャッシュはnullで、xlsx-recalculateは呼ばれていない。最終回答も再計算値の読戻しは未実施と明示している。この1回で画像までの無介入経路は確認できたが、再計算結果を保存したXLSXや反復成功率の確認とはしない。直前のb4eb5f5は画像生成までで終了し、別の試行ではCLI構文確認に実行回数を消費して停止した。今回のJSON保存対応は後者の具体的な構文問題への修正であり、常に完走する保証ではない。

## 実行回数の方針

利用者の指定により、Relay独自のターミナル3回・全ツール12回という累積制限を撤廃しました。モデルへ渡す回数予算と「2回失敗したら停止」という案内も削除しています。作成・検証・修正を回数だけで打ち切りません。過去の検証記録にあるtool_loop_detectedは旧方式の結果です。

結果不明の要求の重複送信防止、要求ID・引数の検証、各処理のタイムアウト、利用者の中止と実際の権限拒否は維持します。これはRelay側の制限撤廃であり、VS CodeやM365側の利用上限を変更するものではありません。

## 回数制限撤廃版の文書課題

73b3981配布候補で、再計算結果をresult.xlsxに保存することを明示した固定1ページPDF課題を実施。追加助言なしで9要求・184,810ms・Relayエラー0、ターミナル4回を含む作成→再計算保存→読戻し→PDF/PNG→view_image→最終回答が完了した。独立した読戻しで品目・値・SUM式・計算結果2.5/41.5・注記の完全一致を確認し、既存25ファイルのSHA256は不変。観測者も生成PNGを確認した。旧ターミナル3回制限なら4回目で止まる経路であり、固定回数制限の撤廃後に完走した実例となる。

これは一つの固定課題での成功であり、一般的な文書作業の成功率・大量文書・会社の初回導入の保証ではない。ローカル配布10検査とCI34215411611全ジョブも成功。検証用接続プロセスは終了した。
`pdf-text input.pdf [--pages 6-10]` は座標を取得せず、ページ番号と本文だけを返します。既定は冒頭5ページ。totalPages、parsedPageNumbers、documentCompleteで読取範囲を区別します。本文48,000文字超は範囲を狭めるエラーとなり、黙って切り詰めません。内容説明にはこちらを使い、表・配置の確認には従来のpdf-readと画像を使います。
