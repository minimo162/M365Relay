# Python文書ランタイム（0.2.23候補）

利用者の社内環境の方針に合わせ、OfficeCLIとLiteParseを配布から外し、アプリ内のPythonと必要なライブラリへ移行する。接続サーバーのNode.jsは維持する。PythonはOSへインストールせず、レジストリ・通常のPATH・既存Python環境を変更しない。

## 同梱構成

- CPython 3.13.15 Windows x64 embeddable: 公式ZIPとpython.exeをSHA256固定。
- openpyxl 3.1.5 / et_xmlfile 2.0.0: Excel作成・読取。
- pypdf 6.18.0: PDFの分割・結合などのPython API。
- pypdfium2 5.13.0: PDF文字と座標、ページ描画。
- Pillow 12.3.0: PNG/JPEGなどの画像処理。任意のAVIFコーデック約8MBは除外。

pip、Tcl/Tk、pandas、NumPy、OCRエンジン、OfficeCLI、LiteParseは入れない。Python標準ランタイムは削らず、`_pth`で同梱パッケージのみを参照する。実行は`-I -B`を使う。ライブラリのバージョン・公式配布URL・SHA256はconfig/python-runtime.lock.jsonに記録し、wheelのライセンスとdist-infoを保持する。ライブラリ導入にpipやsetup.pyの実行は不要で、固定wheelをビルド時に展開する。

Python本体と5パッケージは展開後38,703,365 bytes（約36.9MiB、初期実測）。配布全体はNode等を含むため別に測る。AVIF以外の追加削除で標準ライブラリを壊す削減は行わない。

## Officeの扱い

openpyxlは数式を保存するが計算しない。数式の再計算・Officeと同じ描画・Word/PowerPointの作成は、端末にあるデスクトップ版Microsoft OfficeをWindows PowerShell COMで利用する。Office自体、pywin32、lxmlは同梱しない。

この端末ではpython-docx/python-pptxの依存lxml DLLがWindowsのアプリ制御に拒否されたため、採用を取りやめた。制御は解除していない。PDFium/Pillowの必要なモジュールはこの端末で読み込めたが、これだけで会社の承認済みとは判断しない。ネイティブDLLは残るのでTHIRD_PARTY.mdと固定依存一覧を社内確認に使用する。

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
