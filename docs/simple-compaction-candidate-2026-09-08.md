# ツール定義を付けない圧縮モードの比較候補

状態: partial、未適用・未実測。fidelity-v3の途中で設定を変更しない。

インストール済みVS Code 1.136.1 / Copilot 0.64.1のextension.jsを確認した。

- `AgentHistorySummarizationMode` は旧 `chat.advanced.agentHistorySummarizationMode` から `chat.agentHistorySummarizationMode` へ移行する設定として登録され、名前空間は `github.copilot`。
- `getSummaryWithFallback` は設定値が `simple` なら `getSummary("simple",...)` を選ぶ。
- `getSummary` は `full` の場合にツール定義を要求へ含める。`simple` ではその定義を付けず、simpleModeを指定して要約用メッセージを構成する。

実観測では通常・full圧縮の要求に約64,456〜64,902文字のツール定義が含まれる。短い固定課題でも圧縮が頻発しているため、通常の作業ツールを制限せず、圧縮要求だけの入力量を減らせる可能性がある。

試す設定候補は `github.copilot.chat.agentHistorySummarizationMode: "simple"`。現在はソース上の経路を確認した段階で、当該プロファイルへの適用、実際の有効化、速度・要約品質・background経路への影響は未検証。実際に送信された要求でtools数と本文サイズを確認し、目的・禁止事項・実行済み結果・未完了作業の保持と成果物を検査する。要約品質を下げて速く見せる変更にはしない。

fidelity-v3の終了確認後、専用プロファイルのこのキーだけをsimpleへ変更し、読み戻し確認した。元の存在有無と値は `.local/input-events/simple-setting-before.json` に保存。製品の既定値にはまだ追加していない。新規課題で実際の要求に反映されるかと、速度・意味の保持を次に検証する。

## simple-v4の途中観測と背景経路

simple設定で同じ新規課題を開始したが、最初の要約相当要求は105981文字・51ツールで、full相当の定義を含んでいた。設定の読み戻しだけで軽量化成功とは扱えない。

インストール済みextension.jsのbuildPromptを追加確認。入力枠hからツールトークンpを引いた会話用枠は `max(1, floor((h-p)*0.9))`。要約が有効なら背景要約器を取得し、条件に応じて_startBackgroundSummarizationを開始する。この背景経路は先に確認したgetSummaryWithFallbackのsimple分岐とは別で、今回のsimple設定だけで置き換わる根拠はない。通常の同期圧縮に効く設定と背景圧縮への効果を区別する。

試験は継続中で、結果・速度改善は未確定。単に要約を無効にしたり、実際の入力可能量を超えるトークン枠を宣言したりする対策は行っていない。

## simple-v4終了・設定を不採用

試験は19:02:40.134Z〜19:09:13.996Z、約394秒（画面6分34秒）で終了。21要求、20搬送成功・1形式エラー、backend合計390292ms。背景要約に全ツール定義が残り、要約軽量化の有効化を確認できなかった。単一試行の24秒差をsimple設定の高速化効果とは断定しない。

3ファイルを編集・再読したが、amountを生成せず合計する実装を残し、最終verifyはNaNで不合格。再読したとの報告は正しさの証拠にならなかった。記録は `.local/input-events/simple-v4-results.json`。

この比較では採用理由を得られなかったため、終了後に専用プロファイルの設定を保存済み状態へ復元した（元はキーなし）。他の設定は維持。製品既定には追加しない。次は検証結果を反映して修正するループの確認と、ツール定義固定費を減らす方式を検討する。
