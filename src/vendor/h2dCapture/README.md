# Vendored h2d capture bundle

`capture.js` is the built bundle of the private sibling repo `html-capture`
(a clean-room TypeScript reimplementation of the html.to.design DOM-capture
script). It is injected into a sandboxed iframe by
`src/lib/h2dCapture/captureEmbed.ts` and exposes `window.__h2d_clone.en()`.

Do not edit by hand. To update: build `../html-capture` (`npm run build`),
then run `./scripts/update-h2d-capture.sh`.
