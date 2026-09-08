# TXT添付の製品統合（2026-09-08）

0.2.17の通常CLIはattachToolDefinitionsを有効にする。ルーター指示と全toolsを要求ID入りUTF-8 TXTへ移し、本文にはファイル名・SHA256と会話JSONを送る。ツール定義はサーバー側の検証・重複判定から削除しない。毎回新しい会話へ添付し、添付済みか不明な要求は再送しない。

実M365、GPT 5.6 Think DeeperでVS Codeの実51ツールを搬送。添付81327 bytes、本文1260文字でread_fileのfilePath、startLine=3、endLine=8が正しく返り、厳密パーサーを通過した。これはブラウザー経路の実測で、ロック中のVS Codeからの全操作を示すものではない。

Windowsはロック中。Tailscale BackendState=Running、SelfOnline=true、RDPサービス稼働、接続許可、3389待受を確認。Tailscaleはネットワーク接続であり、既存Codexセッションに別の対話デスクトップを提供するものではない。資格情報を使用したRDPログオンやロック設定変更は行っていない。M365の専用ブラウザー/CDP操作はロック中も実測成功。
