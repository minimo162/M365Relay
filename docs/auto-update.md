# 起動ファイルと本体を分けた配布

利用者は配布先の `M365Relay.cmd` をダブルクリックします。起動ファイルと小さな `_launcher` フォルダーは同じ場所に置きます。本体ZIPは `_updates` または管理者が指定したHTTPS配布先に置き、利用者が手作業で展開する必要はありません。

起動時に版情報を確認し、初回・更新時だけ本体を取得します。ZIPと内包manifestのSHA-256を照合し、展開後の全manifest記載ファイルを検証してからローカルの有効版を切り替えます。Node.jsも本体に含みます。

HTTPSの版情報取得には10秒、本体ダウンロードには180秒の要求タイムアウトを設定します。更新確認と大きな本体の転送を分け、版情報を取得できない場合は検証済みのローカル版を使います。この設定は共有フォルダーのOS側通信待ち時間を制御するものではありません。

本体は `%LOCALAPPDATA%\M365Relay\app\versions` に版別に保存し、既存の設定・認証・チャット履歴・workspaceは従来の保存先を使います。`M365_RELAY_HOME` と旧 `M365_BRIDGE_HOME` にも対応します。更新先が取得不能・破損している場合、前回版も検証できたときだけ前回版を起動します。初回で本体を取得できない場合やローカル本体も壊れている場合は停止します。

更新確認と配置は排他処理です。実行中の本体を書き換えず、新版は別フォルダーへ配置します。検証失敗では有効版ポインターを変更しません。旧版は削除しないためディスク容量を消費します。ハッシュは破損・混在を検出するものであり、悪意のある配布元を信頼できる発行者に変える署名ではありません。配布元の書込み権限は管理者に限定してください。

## 管理者による公開準備

まず従来の `scripts/Package-Release.ps1` で本体ZIPを作成し、配布検査を通します。

```powershell
./scripts/New-UpdateChannel.ps1 -ZipPath ./dist/M365Relay-<version>-win-x64-<revision>.zip -OutputDirectory C:/Distribution/M365Relay
```

出力は `M365Relay.cmd`、`_launcher/Update.ps1`、`_launcher/source.txt`、`_updates/update.json`、`_updates/<本体ZIP>` です。共有フォルダーではこの構成を保って配置してください。更新時は同じ出力先へ新版ZIPで再実行します。新版ZIPを配置してからupdate.jsonを原子的に切り替えます。

HTTPSでは `-Source https://<配布先>/update.json` を指定し、`_updates` 内のupdate.jsonとZIPをそのURLの同じディレクトリへ公開します。利用者へ渡すのはM365Relay.cmdと_launcherだけです。GitHub Releasesの `/releases/latest/download/update.json` と同一リリースのZIP添付も、この構成で利用できます。認証が必要な配布先のサインイン支援は含みません。

起動ファイル側は本体とは別管理で、現在は自己更新しません。今回の変更で公開先へアップロードしたわけではありません。公開済みのURLでのHTTPSダウンロードは別途確認が必要です。

検査: `scripts/Test-Updater.ps1 -FirstZip <旧ZIP> -SecondZip <新ZIP>`。初回取得、キャッシュ再利用、更新、改ざんZIP、パス逸脱、壊れたメタデータ、排他、壊れたローカル本体、利用者ファイル保持をWindows PowerShell 5.1で検査します。
