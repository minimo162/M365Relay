# PNG/JPEGの複数画像搬送

チェックポイントmainからcodex/image-multiformat-validationを作成。Issue #4の画像検証を進めた。

認証付きHTTPから、PNG900x430のはみ出し検査画像とJPEG700x220の金額画像を同時に送った。製品の画像パーサー・M365自動添付・モデル選択・応答検証を使用。モデルに正解の見出しや金額を本文で教えず、画像から回答させた。

初回は「識別子」と依頼したところV-583/J-924というID部分を回答した。テスターが見出し全文を期待していたためassertは失敗したが、これは指定の曖昧さであり画像取違えの証拠ではない。要求を「見出し行全体を省略せず」と明示し、新規要求で再試験した。

明確化後はLAYOUT CHECK V-583、JPEG CHECK J-924、2枚目の合計73.25、1枚目の赤枠はみ出しtrueがすべて完全一致。全体11668ms、image_attach1794ms。HTTP→実M365の試験でありVS Codeの実view_image出力経路はまだ未検証。

実JPEGを回帰fixtureとして追加し、PNG/JPEGの寸法・元message/part位置・別添付名を検査。途中で切れたJPEGも拒否する。4枚上限いっぱい、長期会話、会社環境での画像処理は未検証。

証拠: .local/vision-probe/multi-result.json（初回の期待値不一致）、multi-full-result.json（明確化後合格）、test/fixtures/vision-jpeg.jpg、test/image-input.test.mjs。
