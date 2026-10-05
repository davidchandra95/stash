# PDF viewer fixtures

These synthetic fixtures contain no user documents. They were generated for Stash using ReportLab and pypdf and may be freely used with the project tests.

- `text.pdf`: six pages of selectable text and repeated search phrases.
- `rotated.pdf`: the same text, with pages 2 and 4 rotated 90 and 270 degrees.
- `scanned.pdf`: one raster image with no text layer.
- `large.pdf`: 300 pages; the unique phrase "Needle on the distant page" appears on page 290.
- `encrypted.pdf`: the six-page text fixture encrypted with the test-only password `fixture-password`.
- `corrupt.pdf`: a PDF header followed by invalid content.

Run `npm run test:pdf`. Install the test browser first with `npx playwright install chromium` if needed. Results and failure traces go under `.artifact-work/pdf-tests/`.
