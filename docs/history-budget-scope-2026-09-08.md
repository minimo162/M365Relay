# 履歴に基づくツール回数制限の範囲

状態: 通算制御は未実装。現行制御の範囲を再現確認した。

prepareRequestは最後のuserメッセージ以降の構造化tool_callsを数える。12回の呼出し・結果を持つ履歴は次のツール選択を拒否するが、その履歴を要約文へ置き換えると0回と数え、次の選択を許す。ローカルの合成要求で確認し、業務ツールは実行していない。

再現: `.local/input-events/budget-history-audit.mjs`、結果: `budget-history-audit-result.json`。

READMEの通算上限に読める説明を訂正した。要約文の自己申告をカウントへ採用する対策はしない。現在の履歴内ガード、要求台帳、承認・実行の所在は維持する。

圧縮をまたぐ通算制御には、別チャットや新しい依頼を取り違えない、クライアントからの安定した会話・ターン識別と、実行結果の継続的な追跡が必要。現行の標準Custom Endpoint経路でその識別が取得可能かは未確認。固定のプロファイルIDで全チャットを一括カウントする方法は、独立した依頼を誤って停止するため採用しない。

## 実要求の識別ヘッダー

localhost:8732の診断用中継を通して既存の製品サーバー8731へ転送し、実VS Codeから2ファイル読取を依頼した。本文や認証値は記録せず、ヘッダー名と候補識別値のSHA256短縮値のみを記録した。圧縮を含む4要求でX-Interaction-Idのハッシュは一致し、X-Request-IdとX-Agent-Task-Idは要求ごとに変わった。X-Conversation-Id/X-Session-Idはなかった。記録は `.local/input-events/header-audit.jsonl`。

ただしインストール済CopilotのIInteractionServiceは1つの_interactionIdを持ち、startInteractionで置き換える構造。チャット開始以外にレビューやrename処理もstartInteractionを呼ぶ。並行チャットや別操作での完全な挙動は未実測だが、永続的な会話IDである根拠はなく、これだけを通算制御の識別子として採用しない。

診断要求は読取と最終回答まで終了。専用モデルのURLを8731へ復元し、診断proxy exec13891を停止した。既存製品サーバーはPID44556/exec5353で維持。通常の直接経路に戻っている。
