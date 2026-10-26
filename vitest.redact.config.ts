// Local-only experiment config. Not committed.
import { mergeConfig } from "vitest/config";
import { redact } from "@tanstack/redact/vite";
import base from "./vitest.config";
const cfg = mergeConfig(base, {
  plugins: [redact()],
  resolve: {
    alias: [
      { find: "use-sync-external-store/shim/index.js", replacement: "@tanstack/redact" },
      // Its CJS build require()s the real react-dom outside Vite's resolver.
      { find: /^@testing-library\/react$/, replacement: new URL("./node_modules/@testing-library/react/dist/@testing-library/react.esm.js", import.meta.url).pathname },
    ],
  },
});
// Inline every dependency so node_modules packages also resolve React to Redact.
cfg.test!.server = { deps: { inline: true } };
export default cfg;
