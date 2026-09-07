# LiteParseとPdfKoseiAssistの比較

参照: ローカルPdfKoseiAssist HEAD 43c35a2、origin https://github.com/minimo162/PdfKoseiAssist.git。NUMBER_MASKING_SPEC.mdの過去試験、js/pdf-text-reconstruct.mjs、tools/pdfjs-headless-runner.mjsを確認した。PDF.js5.6.205と再構成バージョンを製品・監査で揃える設計がある。

LiteParse現npm版2.14.4はRust/PDFiumエンジンのNodeバインディング。Node>=18、Windows x64ネイティブ配布あり。検証環境で依存監査の指摘0。Windowsパッケージは.node 19150336bytes、pdfium.dll6980096bytes。Python不要で動作した。ただしPython不要はネイティブ依存やOCR言語データ不要という意味ではない。

同梱Node22.23.2で合成1ページPDFを解析し、文字・数値・記号と11個の位置付き項目を確認。処理約958msはページ画像取得を含む小規模試験で、一般速度を示さない。OCRは明示的にfalse。

続いてPdfKoseiAssistのaoi-long_ja_REF.pdfの71–72ページを同じNodeからLiteParse markdownモードで解析した。現在のファイルは201ページで、過去記録の140ページ版とは同一ファイルだと断定しない。指定2ページ処理は初回29ms、続行10ms。preserveVerySmallTextのfalse/trueの両方で次の欠点を再現した。

- 71ページは主要数値が表のセルに対応する。
- 72ページは表の値セルが空になり、10,600 / 8,100 / 4,200 / 537が表外の段落へ移る。
- 72ページのtextItemsには値とx/y座標が残っている。
- LiteParseの座標を検証用にPDF.js型へ変換し、PdfKoseiAssistの純粋関数reconstructTextContentByVisualLinesへ渡すと4組の項目/値が同じ行へ復元された。4組をassertした。これは2ページ限定の適用であり、複雑段組み全体の移植完了ではない。

採用方針候補: LiteParseを読取・座標・画像取得に使い、ページIDと原文textItemsを一次情報として保存。Markdownは派生表示として扱い、原文の数値・項目との照合を入れる。ヘッダー/フッター削除を無条件に有効にしない。OCRは無効を明示した文字PDF経路と、言語データをローカル同梱したOCR経路を分離する。文字PDFの今回成功を日本語OCRやオフラインOCR成功に一般化しない。

OfficeCLIはOffice編集、LiteParseはPDF読取、PDFの結合等はpdf-libという役割分担が候補。LiteParseのOffice入力はLibreOffice変換を使うので、OfficeCLIを置き換える理由とはしない。

検証コード/結果: .local/liteparse-evaluation。製品へのLiteParse同梱は未実装。別作業中のOfficeCLI同梱変更はワークツリーに保持し、未完成の配布を作っていない。

Sources: https://github.com/run-llama/liteparse 、https://github.com/run-llama/liteparse/tree/main/packages/node 、https://github.com/minimo162/PdfKoseiAssist
