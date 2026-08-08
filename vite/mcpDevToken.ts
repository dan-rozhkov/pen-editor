import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "vite";

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export interface McpHandshake {
  url: string;
  token: string;
  port: number;
}

function isHandshake(value: unknown): value is McpHandshake {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { url?: unknown }).url === "string" &&
    typeof (value as { token?: unknown }).token === "string" &&
    typeof (value as { port?: unknown }).port === "number"
  );
}

/**
 * Reads the MCP dev handshake file pen-editor-backend writes at
 * `<home>/.pen-editor/mcp.json` (mode 0600) when it starts with no
 * MCP_AUTH_TOKEN set — the backend then generates a token, serves MCP
 * loopback-only, and writes this file. Returns the parsed, validated
 * handshake entry (token *and* the url/port the backend is actually
 * listening on) when the file exists and is well-formed, `undefined`
 * otherwise. Missing, unreadable, or malformed files are always a silent
 * no-op, never a thrown error — this only smooths local dev ergonomics and
 * must never break `vite dev`.
 */
export function readMcpHandshake(homeDir: string): McpHandshake | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(homeDir, ".pen-editor", "mcp.json"), "utf-8");
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!isHandshake(parsed) || !TOKEN_PATTERN.test(parsed.token)) return undefined;
  return parsed;
}

/**
 * Resolves whatever `VITE_MCP_WS_TOKEN` value Vite itself would end up using,
 * the same way Vite resolves it internally: parsed `.env`/`.env.local`/etc.
 * files, with any real `process.env` value taking precedence over those
 * (this is `loadEnv`'s own precedence, not ours).
 *
 * This MUST be used instead of reading `process.env.VITE_MCP_WS_TOKEN`
 * directly: `loadEnv` applies `process.env` *after* the parsed `.env`
 * files, so a raw `process.env` read at config-eval time misses a token set
 * only in `.env.local` — and if that miss is then (wrongly) treated as "no
 * existing token" and used to justify writing a handshake token into
 * `process.env`, the *next* `loadEnv` call sees that injected value as if it
 * were a real env var and lets it clobber the `.env.local` value, silently
 * inverting the "explicit token always wins" contract.
 */
export function resolveExistingMcpToken(mode: string, envDir: string): string | undefined {
  return loadEnv(mode, envDir).VITE_MCP_WS_TOKEN;
}

/**
 * Dev-only convenience: when `VITE_MCP_WS_TOKEN` isn't already set (per
 * `resolveExistingMcpToken`), pull the handshake entry the backend wrote so
 * the MCP bridge just works in local dev with zero configuration. Returns
 * the whole handshake (not just the token) so the caller can also derive
 * the WS endpoint from the handshake's own `url`/`port` instead of assuming
 * it matches whatever `VITE_AI_API_URL` happens to say — those two can
 * disagree (e.g. backend started with a non-default `PORT`).
 *
 * Callers MUST gate this on `command === "serve"` (checked here too, as a
 * second line of defense) — `VITE_*` values are inlined into the production
 * bundle at build time, so shipping a real token into `vite build` output
 * would leak the secret to every visitor. An explicitly-set token always
 * wins; this function never overrides one.
 *
 * `disabled` exists purely to keep the Playwright e2e suite hermetic: it
 * runs against `npm run dev`, and picking up a live handshake there would
 * make the suite behave differently on a machine with a running backend
 * than in CI (which has none) — see playwright.config.ts, which sets
 * `PEN_EDITOR_E2E=1` on the dev server it spawns.
 */
export function resolveDevMcpHandshake(options: {
  command: string;
  existingToken: string | undefined;
  homeDir: string;
  disabled?: boolean;
  log?: (message: string) => void;
}): McpHandshake | undefined {
  const { command, existingToken, homeDir, disabled = false, log = console.log } = options;
  if (command !== "serve") return undefined;
  if (existingToken) return undefined;
  if (disabled) return undefined;

  const handshake = readMcpHandshake(homeDir);
  if (!handshake) return undefined;

  log("[vite] MCP bridge token picked up from ~/.pen-editor/mcp.json (dev-only, never used in builds)");
  return handshake;
}

/**
 * Derives the MCP WebSocket base URL (`ws://host:port/api/mcp/ws`) from the
 * handshake's own `url` field (`http://127.0.0.1:<port>/api/mcp` per the
 * backend's documented contract — see pen-editor-backend's
 * `writeHandshakeFile`), rather than from `VITE_AI_API_URL`/
 * `VITE_DESIGN_AGENT_BACKEND_URL`, which point at wherever the *chat*
 * backend is configured to be and can disagree with the port the handshake
 * file's backend instance actually bound (e.g. a backend started with
 * `PORT=3002` while `VITE_AI_API_URL` still hardcodes `:3001`).
 */
export function deriveMcpWsUrl(handshake: McpHandshake): string {
  return `${handshake.url.replace(/^http/, "ws")}/ws`;
}
