# Document Reader

Reads PDFs, Word (.docx) and text files aloud in the browser with Gradium's Phonon 31M
text-to-speech model. Static files only: open `index.html` from any web server.

- `app.js`: model loading, playback, read-along highlighting, WAV export
- `extract.js`: PDF / Word / text to paragraphs
- `voices.json`: English voice catalog (files in `gradium/phonon-voices` on Hugging Face)
- `coi-serviceworker.min.js`: adds the cross-origin isolation headers GitHub Pages can't send,
  so speech generates on 3 CPU threads instead of 1

Vendored libraries (`vendor/`), copied from npm:

| Package | Version | Files |
|---|---|---|
| phonon-tts | 0.4.0 | `index.js`, the other top-level `.js` files, `wasm/`, `wasm-threads/` |
| pdfjs-dist | 4.10.38 | `build/pdf.min.mjs`, `build/pdf.worker.min.mjs` (renamed to `.js`), `cmaps/` |
| mammoth | 1.9.0 | `mammoth.browser.min.js` |
| coi-serviceworker | 0.1.7 | `coi-serviceworker.min.js` |

Model and voices are Apache 2.0 and download from Hugging Face on first use.
