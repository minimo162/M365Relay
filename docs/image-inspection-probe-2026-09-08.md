# M365画像入力による表示検査

ユーザーが初回画像確認の「確認して続行」を押した後、専用タブのDOMで確認画面が消え、layout.pngが添付された状態を確認した。ネイティブ画面取得は黒画像/アクセス拒否となったため、座標操作は続けず、所有検証済み専用EdgeのDOM操作で要求を送った。

対象は900x430の合成PNG。赤枠から文言が右へはみ出し、緑枠の文言は収まっている。個人情報・人物なし。要求本文には正解の識別子や枠内文言、どちらにはみ出しがあるかを書かず、画像からのJSON回答を依頼した。送信直前にGPT 5.6 Thinkの表示を確認した。

返答はidentifier=LAYOUT CHECK V-583、赤枠text=Quarterly Performance Overview/overflow=true/right、緑枠text=Revenue 125 / Cost 80 / Margin 45/overflow=false。連続する19行のJSONを読み、全項目の完全一致assertに合格。

これはM365への直接画像添付での限定試験。製品のChat Completions入力はまだtext_only/vision=falseで、VS Codeのview_image結果等を自動搬送する実装は未完。製品のStrict BRIDGEパーサーは通常JSONを意図的に受けないため、試験用のJSON読取を製品の応答検証に混ぜていない。

次は画像と発生元ターン/ツール結果の対応、画像数/サイズ/型の制限、添付完了確認、本文と画像を同じ要求で送る仕組み、失敗/重複送信の扱いを実装・検証する。機密画像や会社環境での利用が承認された証拠にはしない。

証拠: .local/vision-probe/layout.png, request.json, answer-lines.json, validated-answer.json。厳密な応答完了時間は計測していない。
