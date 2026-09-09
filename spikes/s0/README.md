# M365Relay S0 live spike

`live.mjs` is an isolated, single-threaded observer for the attached S0
fixtures. It reuses the product's owned-Edge/CDP guard, uploads only the
fixture selected by each route, confirms an empty destination conversation,
waits for a complete assistant result, and records hashes plus bounded stage
metadata in the trial's `observations.json`.

The fixture generator/checker and prompts are supplied in
`M365Relay-spike-s0.zip`. From that extracted directory:

```powershell
node .\spike.mjs prepare .\trial-N
node --test .\spike.test.mjs
node C:\Users\yuuki\M365Relay\spikes\s0\live.mjs .\trial-N
```

The runner does not read credentials, cookies, browser storage, or the P2
operator-only source as a recovery fallback. P2 recovery is recorded as a
failure when the Copilot surface exposes no downloadable/recapturable artifact;
P4 is recorded as unsupported when `native-result.txt` is not exposed by the
selected surface and mode. Never reuse a trial directory after live execution.
