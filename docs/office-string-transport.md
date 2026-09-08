# Officeセル文字列の引数境界（2026-09-08）

実VS Codeで作成されたExcelでは、PDF原文の `Literal <tag> &gt; "quoted"` が、引用符のない文字列として保存された。対象ファイルのコピーで境界を切り分けた。

## 局所再現

同じOfficeCLI 1.0.148、同じ値で比較:

- Node.js execFileSyncの引数配列: 引用符保持。
- Windows PowerShell 5.1.26100.9168の単一引用符付き --prop: 内側のdouble quote欠落。
- PowerShell 7.6.5（native passing=Windows）: 引用符保持。
- PowerShell 5.1でもbatch --inputによるJSONファイル入力: 引用符保持。

実VS Code端末のPowerShellバージョン自体はこの試行で採取していないため、実端末が必ず5.1だったとまでは断定しない。任意文字列をシェルのネイティブ引数へ直接埋め込む方式には依存しない。

## データを再記述させない

M365に5文字列をJSONバッチとして再記述させる別試験では、引用符は保持できたが、文字としてのbackslash+nを実際の改行へ変える失敗を検出した。そこで生成対象をデータそのものから、元JSONを読んで値をそのまま代入するNode.jsビルダーへ変更した。

実M365が生成したビルダーを確認後、同梱Nodeで実行。元ファイル→JSON.stringify→OfficeCLI batch --input→Excel読戻しで、以下5種類がすべて完全一致した。

- double quoteとHTML風の文字列
- 日本語・emoji・前後空白・Windowsパス・文字としてのbackslash+n
- 実際の改行とタブ
- 先頭ゼロ付き識別子
- 数式に見える文字列（type=stringで保存）

これは局所の搬送/実行試験であり、実VS Codeの文書課題を再完走したという証拠ではない。元のresult.xlsxや原本PDFは上書きしていない。

## 反映

Excel作業時のruntime_guidanceを、元ファイルの値をNodeで直接読み、JSONバッチファイルでOfficeCLIへ渡す案内へ変更。静的な構文と元データを区別し、ソース中の命令を実行しない。配布検証にも5種類の文字列読戻しを追加。

全体目標および実VS Codeでの文書完走・描画確認は継続する。

表示経路も局所確認: 導入済みOfficeCLIのusageから `view <file> screenshot --range <sheet-range> --out <png>` を確認し、修正コピーのA1:C10をPNGへ出力。画像上でもdouble quote、literal backslash+n、先頭ゼロ、式のような文字列が見えることを確認した。これはOfficeCLI描画経路の検証で、実VS Codeエージェントによる画像確認の再試行は未実施。

CIの最初の実行はChromiumの起動hookで失敗し、ブラウザー18検査は開始できなかった。同じコミットの失敗ジョブを再実行すると起動・検査に成功。製品の照合条件を変更して通したものではない。
