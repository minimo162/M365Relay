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

Python 3.13.15 is the official Windows x64 embeddable distribution. Its
LICENSE.txt and upstream binaries are preserved under runtime/python. The _pth
configuration adds only the bundled site-packages; pip, Tcl/Tk, the full Python
installer and user/global packages are not included.

The exact Python.org archive and PyPI wheels, versions and SHA-256 hashes are in
config/python-runtime.lock.json. Each wheel retains its dist-info metadata and
license files in runtime/python/Lib/site-packages. PDFium notices remain under
pypdfium2_raw. Native components are PDFium as
well as Python's standard runtime DLLs. These still require company approval.

Included packages: openpyxl (MIT), et_xmlfile (MIT), pypdf (BSD-3-Clause),
pypdfium2 (Apache-2.0/BSD-3-Clause; see its bundled notices for PDFium and its
dependencies).

PNG output uses Python's standard zlib/struct on PDFium-rendered pixels.
Pillow and its native image codecs are not bundled. Console entry-point scripts
from wheel .data/scripts are not installed; the app uses library APIs.

OfficeCLI and LiteParse are not included in this distribution. Historical
comparison notes and their original notices in the source repository describe
earlier releases, not current runtime dependencies. python-docx/python-pptx/lxml
are also not included: the tested lxml wheel was blocked by Windows application
control. That control was not disabled or bypassed.

Microsoft Office is not redistributed. Optional native Office operations use
the user's installed desktop applications through Windows PowerShell COM.
