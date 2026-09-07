# 作業フォルダーの実パスと外部読取確認

状態：partial。起動処理の修正とファイル同一性の確認を実施。修正後の無介入通し検証は未完了。

## 原因の確認

AppData配下の検証フォルダーについて、同期realpathは指定した見かけのパスを返したが、非同期realpathはWindowsパッケージのLocalCache配下を返した。
VS Code自身のCode.exeをNodeモードで実行して同じ差を確認した。実行環境はWindows、Node 24.18.1。

- 見かけの位置：`%LOCALAPPDATA%/M365Relay/workspace/phase-benchmark-20260908`
- 非同期realpathの位置：`%LOCALAPPDATA%/Packages/<呼出元パッケージ>/LocalCache/Local/M365Relay/workspace/phase-benchmark-20260908`
- lstatではシンボリックリンクではない。
- 両方のSPEC.mdを非同期statし、devとinoが一致することを確認。同一ファイルであり、コピーや別データではない。

インストール済みVS CodeのCopilot拡張は、読取前に非同期realpathで得た場所が作業フォルダー内かを再確認していた。見かけのフォルダーを開いた状態では、その再確認で外部ファイルの確認が出る。
したがって、先行試行の二重バックスラッシュやドライブ文字の大小だけを根因とする説明は不十分だった。

Microsoftの説明でも、パッケージ化されたデスクトップアプリではAppDataへの書込みがアプリ専用の場所にリダイレクトされる場合がある。
参考：[Understanding how packaged desktop apps run on Windows](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes)。

## 修正

prepareDesktopで、存在確認または作成を終えた作業フォルダーに非同期realpathを適用し、その実保存先をVS Codeへ渡す。
確認に失敗した場合は別のパスを推測せず、エラーにする。
通常のVS Code設定・フォルダー信頼・外部アクセス許可は変更しない。ファイルも移動しない。
ユーザーが選択したリンク先フォルダーでも同じ処理を行う。

## 検証

- 実Windowsの非同期realpath、同期realpath、ファイルIDを比較して現象を確認。
- Windowsのjunctionを作る回帰試験で、実フォルダーが起動引数になり、ファイルを保持し、アクセス許可設定を追加しないことを確認。
- realpath失敗時に推測したフォルダーを開かない回帰試験を追加。
- 新しい実保存先のVS Codeウィンドウを開いた。未信頼として表示されたため、ユーザーへ当該フォルダーの信頼操作を依頼。既存の信頼設定をコピーしたり書き換えたりしていない。

先行のAllow Once後は読取が進んだが、次の主要求で入力照合失敗、背景の要求で応答検証失敗が発生した。その試行を成功扱いしない。
修正後のフォルダーでの読取、複数ファイル完走、速度、入力空戻り、会社環境は引き続き検証する。
