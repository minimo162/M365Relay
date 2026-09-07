# Node.js同梱のWindows配布

## 配布契約

利用者は配布ZIPを展開してCMDを実行します。Nodeの導入・PATH変更・起動時のネットワーク取得は不要です。
ソースリポジトリに巨大なnode.exeをコミットせず、CIまたは配布担当者が公式アーカイブから組み込みます。
初版はWindows x64のみです。VS Code・Edge・M365の利用環境は別途必要です。

`config/node-runtime.lock.json`にNodeの版・取得先・公式ZIPのSHA-256・node.exeのSHA-256を固定します。
`latest`を実行時に参照しません。更新はlock変更とテストを含むPRで行います。

## 生成

Windows PowerShell 5.1以降とGitがある、コミット済みで変更のないチェックアウトから実行します。
パッケージ生成には既存のNodeやnpmは不要です。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\Package-Release.ps1
```

インターネットへ接続できないビルド端末では、別途取得した**同じ版の公式ZIP**を渡せます。
ハッシュが一致しないZIPを許可するオプションはありません。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\Package-Release.ps1 -NodeArchive C:\ApprovedDownloads\node-v22.23.2-win-x64.zip
```

処理は公式ZIPの照合→node.exeとLICENSEのみ抽出→exe照合と版確認→配布ファイルを選択コピー→全ファイルのSHA-256 manifest→ZIP・チェックサム生成です。
`runtime/LICENSE`は省略・改変しません。秘密設定、token、Edgeプロファイル、要求台帳、ログは含めません。
manifestには生成元のGit commitを記録します。PRのmerge用コミット由来のZIPと、squash後のmain由来のZIPを区別してください。

## CI

PRとmainへのpushでLinux/Windowsの契約テストを実行します。Windowsではさらに公式ランタイム同梱ZIPを生成し、
PATHからNodeを除いた状態・空白を含むパスで`help`/`init`を試し、再初期化時のキー保持、Node欠落、コード/Nodeの破損拒否を確認します。
M365・Edge・VS Codeへは接続しません。Windowsのパッケージ合格は実業務の合格ではありません。
CI成功後の`M365Relay-windows-x64` artifactに配布ZIPとSHA-256を置きます。通常はmainの成果物を使います。
GitHubのソースZIPを利用者へ配らないでください。

## 起動と保守

`Bridge.cmd`→Windows PowerShellの`Launch.ps1`→manifest検査→`runtime/node.exe`の固定パス、という経路です。
継承された`NODE_OPTIONS`/`NODE_PATH`を除去し、端末の別Nodeや自動ダウンロードに切り替えません。
PowerShell実行ポリシーは起動プロセスだけの指定で、永続設定や組織のポリシーを書き換えません。
ハッシュは欠損・混在・偶発的破損の検出用で、配布元自身の悪意を防ぐ署名ではありません。

更新時は処理を終了し、別フォルダーへ新ZIP全体を展開します。起動中のファイルやランタイムを上書きしません。
ユーザーデータは`%LOCALAPPDATA%\M365Relay`に残ります。旧配布物を残しておけばそのCMDから戻せますが、
将来の設定互換性まで無条件に保証するものではありません。
