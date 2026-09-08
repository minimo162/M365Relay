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

追加調査でCodeIntegrityイベント3077がlxmlのetree.cp313-win_amd64.pydをコード署名ポリシーで拒否したことを確認した。会社の一覧にないことが原因とは判断しない。python-pptxは採用優先だが、許可されたlxml配布物などでこの実行制約が解消されるまで未同梱とする。別の場所へコピーしたり制御を解除して回避したりはしない。Pillowは同梱候補でPNG/JPEG保存・読取・切抜き・拡縮・文字描画を確認済み。

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
