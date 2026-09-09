# Issue #34 — D試験の旧失敗経路の切り分け / 2026-09-09

状態：partial。今回の実VS Code D課題は決定論的コピーで成功した。過去の失敗経路について、保存済みのVS Code chat sessionに端末出力が残っていた。

## Get-FileHashの直接証拠

旧要求の`run_in_terminal`は次のPowerShellを実行していた。

```powershell
$h1=(Get-FileHash '<special.txt>' -Algorithm SHA256).Hash; $h2=(Get-FileHash '<copy.txt>' -Algorithm SHA256).Hash; ...
```

保存済みterminal outputでは、PowerShellが`Get-FileHash`を「用語として認識できない」と報告している。同じ出力で`SPECIAL_SHA256=`と`COPY_SHA256=`は空、後続の文字列比較だけが`HASH_MATCH=True`になっていた。したがって、これはハッシュ不一致ではなく、利用された端末環境に`Get-FileHash`が存在しなかった失敗であり、空値同士の比較を成功扱いしてはいけない。

この証拠は旧UI経路の原因を示すが、RelayがPowerShell環境を変更したことは示さない。現在の製品経路では`copy-verify`を使い、同梱Nodeがバイト数・SHA-256・読み戻しを検証する。

## m365_response_invalid

旧要求のRelayログは、送信済み・応答候補7回・`m365_response_invalid`を記録するが、保存された応答本文全体はなく、生成・DOM抽出・表示のどの段階で崩れたかは確定できない。今回の実VS Code D再試行はHTTP/Relay成功、画面表示成功であり、旧失敗段階を遡って証明するものではない。

chat sessionの保存構造を再確認すると、失敗側のresponse配列には途中までの3 tool invocationと進捗要素はあるが、最終回答本文・候補DOM本文はない。その後の保存結果は`duplicate_request`で、元の結果を再取得できる証拠にはならない。したがって、現在の証跡から生成側とDOM抽出側のどちらかを選ぶことはできない。

## 今回の成功証拠

- `.local/live-vscode-d-result.json`
- source/destination 217 bytes
- SHA-256 `2e515c525172c4ac7ec2d95623c190980091c17eed94f235432ca747b13c631f`
- `byte_equal=true`, `readback_verified=true`
- 端末独立比較でCRLF末尾を一致確認
