// Local-only experiment config. Not committed.
import base from "./playwright.config";
const port = Number(process.env.PW_PORT ?? 5199);
export default {
  ...base,
  retries: 0,
  reporter: [["list"]],
  use: { ...base.use, baseURL: `http://localhost:${port}` },
  projects: base.projects!.map((p) => ({ ...p, dependencies: [] })),
  webServer: {
    ...base.webServer,
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    env: { PEN_EDITOR_E2E: "1", REDACT: process.env.REDACT ?? "" },
  },
};
