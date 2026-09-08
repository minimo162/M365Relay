# Review answer framing investigation

2026-09-08. Synthetic inputs only; no user VBA was copied into these tests.

The original real-M365 response placed END_BRIDGE_FINAL_V2 outside its indexed code textbox. Colons in the review headings remained inside. The response reader correctly rejected the incomplete transport. This reproduces a framing failure, but does not establish the cause of the user's reported VS Code retry.

The prompt now specifies a four-backtick outer fence and shows the complete transport example at the end of the inline request. A longer fence is required if the answer itself contains four or more consecutive backticks. The attachment instructions match. Parsing, request identity checks, end-marker checks, and tool/JSON schema validation are unchanged.

An intermediate instruction specifying eight backticks without a literal example failed: two extra backticks remained after the end marker inside the textbox. It was not adopted.

The final prompt passed three real-M365 requests: two synthetic VBA reviews containing nested code fences and one prose-only review containing colon headings and inline colons. The VBA answers retained their code fences and named arguments. These are three local transport trials, not a guarantee of general reliability or evidence that the released ZIP includes the fix. Local artifacts are under .local/vba-format.

Regression coverage checks colon and nested-fence preservation, missing terminators, and mismatched request IDs. Existing schema and tool-choice rejection tests remain in place.
