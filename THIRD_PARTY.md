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
