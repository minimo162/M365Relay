# Evaluation only

This directory freezes a candidate Node.js PDF/Office dependency set for comparison.
It is not included by Package-Release.ps1 and is not enabled in the application.

2026-09-08: npm audit initially reported uuid via ExcelJS and image-size via
PptxGenJS. The uuid 11.1.1 override removed that advisory; only ExcelJS import and
the v4 API were checked, not full workbook compatibility. PptxGenJS/image-size
still have high-severity advisories, so this candidate is not approved for bundling.
Compare OfficeCLI for Office operations before choosing the production toolkit.
