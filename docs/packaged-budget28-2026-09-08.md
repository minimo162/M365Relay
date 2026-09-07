# 28k候補ZIPの設定・起動・実M365往復

状態: partial。未サインイン利用者の全初回操作ではなく、初期設定生成と既存接続の更新利用を検証した。

対象: `dist/budget28-candidate/M365Relay-0.2.16-win-x64-cc5b5353fdce.zip`。
展開先: `.local/budget28-package/App with spaces`。

空の専用状態ディレクトリで展開済みBridge.cmd setupを実行し、28,000/8,000のモデル設定が自動生成された。接続キー・モデルJSONの手編集は不要だった。この段階ではM365へサインインしていない。

旧観測サーバーPID40848/session31316の終了を確認し、要求台帳を保持して停止済みロックを回収。既存状態を使って展開済みRun.cmdに既存ワークスペースを指定した。既存の所有Edgeを確認し、VS Code起動とローカル待受に進んだ。新サーバーPID19820、exec32584。OSプロセスの実行ファイルが展開ZIP内のruntime/node.exeであることを確認した。

同じローカルHTTP経路から非実行echo_source要求を送り、実M365画面を往復。11564ms、HTTP200、矢印と実体参照リテラルを含む文字列が完全一致した。記録は `.local/budget28-package/packaged-entity-result.json`。試験session13879は正常終了。単発文字列成功は長い編集課題の完走を証明しない。

未確認: 未サインイン状態からの全初回操作、ZIP経由の複数ファイル課題・確認漏れの改善、長い継続作業、独立チャット窓の入力問題。新サーバーは製品CLIのログをexec32584へ出し、旧 `.local/input-events/metrics.jsonl` 観測ファイルは更新しない。
