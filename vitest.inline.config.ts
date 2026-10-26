// Local-only control: same harness as vitest.redact.config.ts, but on React.
import { mergeConfig } from "vitest/config";
import base from "./vitest.config";
const cfg = mergeConfig(base, {});
cfg.test!.server = { deps: { inline: true } };
export default cfg;
