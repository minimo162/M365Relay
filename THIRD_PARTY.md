# Third-party notices

The Windows distribution contains the official Node.js executable and its full LICENSE file,
including bundled third-party notices, at `runtime/LICENSE`.

- Project: Node.js / OpenJS Foundation and Node.js contributors
- Version and Windows architecture: `config/node-runtime.lock.json`
- Source: https://github.com/nodejs/node
- Release and checksum provenance: https://nodejs.org/en/blog/release/v22.23.2
- Official distribution: https://nodejs.org/dist/v22.23.2/node-v22.23.2-win-x64.zip

The upstream executable is not modified. npm, npx, and node_modules are not needed by M365Relay
and are not copied into the distribution. The license file is preserved in full.
The packaging process checks the archive and extracted executable against committed SHA-256 pins.
A hash match is not a claim that a PGP signature or Windows Authenticode signature was verified.

VS Code, Microsoft Edge, and Microsoft 365 Copilot are not redistributed by this project.
M365Relay is an independent adapter, not an official Microsoft product or API.

OfficeCLI 1.0.148 (Apache-2.0) is redistributed unmodified as a self-contained Windows
x64 executable in `runtime/officecli`. Its LICENSE, NOTICE and THIRD-PARTY-NOTICES.txt
are preserved there. Source: https://github.com/iOfficeAI/OfficeCLI/tree/0a450e43389531eadf05510dff209d541c1dec1e
Executable and notice hashes are pinned in `config/officecli-runtime.lock.json`.
Its own updater and automatic resident mode are disabled in the dedicated environment;
M365Relay's distribution manages its version. Rendering can require an external browser.

LiteParse 2.14.4 (Apache-2.0), its Windows x64 native package/PDFium, and commander
are included under `runtime/liteparse/node_modules`. Source: https://github.com/run-llama/liteparse
Exact package versions, download URLs and integrity hashes are recorded in
`runtime/liteparse/package-lock.json`. LiteParse LICENSE, matching PDFium build
notices, Rust dependency notices, Tesseract/Leptonica notices, and unmodified source
archives for MPL-2.0 resvg/usvg are under `runtime/liteparse/notices`.
PROVENANCE.md records the source versions, verification method and its limits.
OCR is disabled in the bundled PDF command; no OCR server or cloud parser is configured.
The embedded native engine includes third-party code whose notices must remain with it.
