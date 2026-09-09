# M365Relay S0 remote review context

This directory is a review-only publication for a remote-only reviewer. It is
not wired into the product entry point, and it must not be treated as a release
artifact.

## Repository baseline

- origin: `https://github.com/minimo162/M365Relay.git`
- main baseline: `75972101f83cf9f5d7606e6343e64f1263a567e2`
- current local worktree has an uncommitted, isolated `spikes/s0` runner
- product code and normal entry points are unchanged by this review branch

## S0 scope from HANDOFF

The spike covers only four material/result resupply routes in a dedicated,
signed-in Microsoft 365 Copilot Edge profile, using non-confidential synthetic
fixtures and serial new conversations:

1. P1-v1: application-owned original, then the same original in a new chat.
2. P1-v2: same filename with a changed revision/unit/limit/exception.
3. P2-direct: user-direct attachment, then recover the artifact or identify its
   version without copying the known operator-only local source.
4. P3-body: capture the actual assistant body, then resupply only that body.
5. P4-file: recover an actual Copilot-generated native file, then resupply only
   that file.

The offline checker is content-only. `content_check=PASS` never proves live
M365 provenance, automatic acquisition, or automatic resupply. Do not start the
follow-on A0/A1/B comparison, P2 repair, workbench integration, or release
publication from this context.

## Current evidence summary

`trial-18-evidence.json` is a redacted summary of the saved trial. The full
local trial remains outside Git. It records the observed statuses, source and
artifact hashes, content-check results, new-chat observations, send counts,
and the P2 recovery boundary without raw account URLs or fixture tokens.

The trial was observed at `2026-09-09T09:45:00.733Z`. The current
`spikes/s0/live.mjs` SHA-256 is recorded in `runner-fingerprint.json`; the
trial record itself has no runner SHA-256 field and the current file was
modified after the trial timestamp. Treat the live result as internally
consistent evidence but do not claim that the exact current runner executed it.

## Review questions

- Is the correct gate classification `complete`, `partial`, or `blocked`?
- Which HANDOFF requirements and deliverables are proven by the redacted
  evidence, and which remain UNVERIFIED?
- Does the missing runtime runner fingerprint require an explicitly approved
  new trial before S0 approval?
- What single bounded next instruction and `/goal` should follow, without
  silently expanding into P2 repair, comparison, or production changes?
