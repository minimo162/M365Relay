# Notice provenance

LiteParse LICENSE is from source commit 22d2dd8cd7f7b9320102b57ddaf0e663ff7d15a8,
the npm gitHead for @llamaindex/liteparse 2.14.4.

PDFium notices are preserved from the corresponding official build archive:
https://github.com/run-llama/pdfium-binaries/releases/download/chromium/8028/pdfium-win-x64.tgz
Archive SHA256: 4c34a516cc8cb3763c2c7dc72164e6a1d98ac352270aebfb7c573fa6049f0dc4
Its bin/pdfium.dll and the npm Windows package's pdfium.dll both have SHA256:
8825cbda60d66b1373a9a14879d7981686d81ac235144b0b5b7e7b0e0d7541d3

Rust notices were collected with cargo-about 0.9.2, using the source commit above,
its unchanged Cargo.lock, the liteparse-napi manifest and Windows x64 target.
The run used --locked --fail and about.toml, excluding dev dependencies, and
completed without unresolved license entries: 345 crates, 212 distinct notice texts.
Build dependencies are conservatively included. rust-dependencies.json omits local
machine paths. This records a source dependency inventory, not a reproducible-build
attestation of upstream's compiled binary.

The tesseract-rs 0.2.0 build.rs pins Tesseract 5.3.4 and Leptonica 1.84.1.
Their notices were retrieved from these exact upstream tags:
- https://raw.githubusercontent.com/tesseract-ocr/tesseract/5.3.4/LICENSE
- https://raw.githubusercontent.com/tesseract-ocr/tesseract/5.3.4/AUTHORS
- https://raw.githubusercontent.com/DanBloomberg/leptonica/1.84.1/leptonica-license.txt

Unmodified source archives for MPL-2.0 resvg/usvg 0.44.0 are supplied in sources/.
Their SHA256 values match the pinned Cargo.lock registry checksums:
- resvg: 4a325d5e8d1cebddd070b13f44cec8071594ab67d1012797c121f27a669b7958
- usvg: 7447e703d7223b067607655e625e0dbca80822880248937da65966194c4864e6
These are the upstream crate sources used by the source dependency graph; no
modifications to those crates are made by M365Relay.
