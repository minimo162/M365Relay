# ツール定義を付けない圧縮モードの比較候補

状態: partial、未適用・未実測。fidelity-v3の途中で設定を変更しない。

インストール済みVS Code 1.136.1 / Copilot 0.64.1のextension.jsを確認した。

- `AgentHistorySummarizationMode` は旧 `chat.advanced.agentHistorySummarizationMode` から `chat.agentHistorySummarizationMode` へ移行する設定として登録され、名前空間は `github.copilot`。
- `getSummaryWithFallback` は設定値が `simple` なら `getSummary("simple",...)` を選ぶ。
- `getSummary` は `full` の場合にツール定義を要求へ含める。`simple` ではその定義を付けず、simpleModeを指定して要約用メッセージを構成する。

実観測では通常・full圧縮の要求に約64,456〜64,902文字のツール定義が含まれる。短い固定課題でも圧縮が頻発しているため、通常の作業ツールを制限せず、圧縮要求だけの入力量を減らせる可能性がある。

試す設定候補は `github.copilot.chat.agentHistorySummarizationMode: "simple"`。現在はソース上の経路を確認した段階で、当該プロファイルへの適用、実際の有効化、速度・要約品質・background経路への影響は未検証。実際に送信された要求でtools数と本文サイズを確認し、目的・禁止事項・実行済み結果・未完了作業の保持と成果物を検査する。要約品質を下げて速く見せる変更にはしない。

fidelity-v3の終了確認後、専用プロファイルのこのキーだけをsimpleへ変更し、読み戻し確認した。元の存在有無と値は `.local/input-events/simple-setting-before.json` に保存。製品の既定値にはまだ追加していない。新規課題で実際の要求に反映されるかと、速度・意味の保持を次に検証する。
