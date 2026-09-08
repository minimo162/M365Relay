# Review answer framing investigation

2026-09-08. Synthetic inputs only; no user VBA was copied into these tests.

The original real-M365 response placed END_BRIDGE_FINAL_V2 outside its indexed code textbox. Colons in the review headings remained inside. The response reader correctly rejected the incomplete transport. This reproduces a framing failure, but does not establish the cause of the user's reported VS Code retry.

The prompt now specifies a four-backtick outer fence and shows the complete transport example at the end of the inline request. A longer fence is required if the answer itself contains four or more consecutive backticks. The attachment instructions match. Parsing, request identity checks, end-marker checks, and tool/JSON schema validation are unchanged.

An intermediate instruction specifying eight backticks without a literal example failed: two extra backticks remained after the end marker inside the textbox. It was not adopted.

The final prompt passed three real-M365 requests: two synthetic VBA reviews containing nested code fences and one prose-only review containing colon headings and inline colons. The VBA answers retained their code fences and named arguments. These are three local transport trials, not a guarantee of general reliability or evidence that the released ZIP includes the fix. Local artifacts are under .local/vba-format.

Regression coverage checks colon and nested-fence preservation, missing terminators, and mismatched request IDs. Existing schema and tool-choice rejection tests remain in place.

## 0.2.28: JSON文字列による最終回答

0.2.27の実PDF読取では、本文抽出と概要生成後、END_BRIDGE_FINAL_V2の次にバッククォート2個のindexed行が残り、応答を拒否した。続く3要求はduplicate_requestで停止しており、M365への追加送信はなかった。同じ末尾の崩れを要約継続試験でも確認した。コピーAPIはNotAllowedErrorとなり、生成原文とレンダラーのどちらが原因かは未確定。

新しいBRIDGE_FINAL_JSONは、本文を1個のJSON文字列として3行の外枠内に置く。通常の3バッククォートだけを使い、本文中の改行・コードフェンスを外枠と分離する。復号は1回だけ。要求ID、終端、tool_choice、response_formatの検証を維持し、余分な末尾を切り捨てない。旧形式は受信互換として残す。

最初の候補では案内例の過剰エスケープによる本文不一致が2件あった。例をJSON.stringifyで生成するよう修正後、実M365でレビュー、summaryタグとWindowsパス、JSON schema指定の3件が原文に完全一致した（14587/16993/16289ms）。新形式で受信したことも確認。179ローカルテスト成功。架空資料の限定試験であり、実PDFの再送や実VS Codeの全工程検証ではない。
