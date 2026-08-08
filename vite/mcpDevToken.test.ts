import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveMcpWsUrl,
  readMcpHandshake,
  resolveDevMcpHandshake,
  resolveExistingMcpToken,
} from "./mcpDevToken";

const VALID_TOKEN = "a".repeat(64);
const OTHER_TOKEN = "b".repeat(64);

// os.homedir() is never touched here — resolveDevMcpHandshake/readMcpHandshake
// take homeDir explicitly, so every test points at an isolated temp dir and
// the real ~/.pen-editor is never read or written.
let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "pen-editor-mcp-test-"));
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

function writeHandshake(content: string) {
  const dir = join(homeDir, ".pen-editor");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "mcp.json"), content, { mode: 0o600 });
}

function writeValidHandshake(token = VALID_TOKEN, port = 3001) {
  writeHandshake(JSON.stringify({ url: `http://127.0.0.1:${port}/api/mcp`, token, port }));
}

describe("readMcpHandshake", () => {
  it("returns the parsed handshake entry from a well-formed file", () => {
    writeValidHandshake();
    expect(readMcpHandshake(homeDir)).toEqual({
      url: "http://127.0.0.1:3001/api/mcp",
      token: VALID_TOKEN,
      port: 3001,
    });
  });

  it("returns undefined when the file is missing", () => {
    expect(readMcpHandshake(homeDir)).toBeUndefined();
  });

  it("returns undefined for malformed JSON", () => {
    writeHandshake("{ not json");
    expect(readMcpHandshake(homeDir)).toBeUndefined();
  });

  it("returns undefined when the token field doesn't match the expected shape", () => {
    writeHandshake(JSON.stringify({ url: "http://127.0.0.1:3001/api/mcp", token: "not-hex", port: 3001 }));
    expect(readMcpHandshake(homeDir)).toBeUndefined();
  });

  it("returns undefined when required fields are missing", () => {
    writeHandshake(JSON.stringify({ token: VALID_TOKEN }));
    expect(readMcpHandshake(homeDir)).toBeUndefined();
  });
});

describe("resolveExistingMcpToken", () => {
  // Regression for finding #1: a raw `process.env.VITE_MCP_WS_TOKEN` read
  // misses a token set only in `.env.local`, because dotenv-style loading
  // never touches process.env for keys not already present there.
  // resolveExistingMcpToken must resolve it the way Vite's own loadEnv does.
  it("picks up a token set only in .env.local", () => {
    const envDir = mkdtempSync(join(tmpdir(), "pen-editor-env-test-"));
    try {
      writeFileSync(join(envDir, ".env.local"), "VITE_MCP_WS_TOKEN=from-env-local\n");
      expect(resolveExistingMcpToken("development", envDir)).toBe("from-env-local");
    } finally {
      rmSync(envDir, { recursive: true, force: true });
    }
  });

  it("returns undefined when no .env file and no process env var set it", () => {
    const envDir = mkdtempSync(join(tmpdir(), "pen-editor-env-test-"));
    try {
      expect(resolveExistingMcpToken("development", envDir)).toBeUndefined();
    } finally {
      rmSync(envDir, { recursive: true, force: true });
    }
  });
});

describe("resolveDevMcpHandshake", () => {
  it("picks up the handshake in serve mode when no explicit token is set", () => {
    writeValidHandshake();
    const log = vi.fn();
    const handshake = resolveDevMcpHandshake({ command: "serve", existingToken: undefined, homeDir, log });
    expect(handshake).toEqual({ url: "http://127.0.0.1:3001/api/mcp", token: VALID_TOKEN, port: 3001 });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("never picks up the handshake in build mode", () => {
    writeValidHandshake();
    const log = vi.fn();
    const handshake = resolveDevMcpHandshake({ command: "build", existingToken: undefined, homeDir, log });
    expect(handshake).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it("lets an explicitly-set token win over the handshake file", () => {
    writeValidHandshake();
    const log = vi.fn();
    const handshake = resolveDevMcpHandshake({
      command: "serve",
      existingToken: "explicit-token",
      homeDir,
      log,
    });
    expect(handshake).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it("is a silent no-op when the handshake file is missing", () => {
    const log = vi.fn();
    const handshake = resolveDevMcpHandshake({ command: "serve", existingToken: undefined, homeDir, log });
    expect(handshake).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it("is a silent no-op when the handshake file is malformed", () => {
    writeHandshake("not json at all");
    const log = vi.fn();
    const handshake = resolveDevMcpHandshake({ command: "serve", existingToken: undefined, homeDir, log });
    expect(handshake).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  // Regression for finding #2: the e2e suite must behave identically
  // regardless of whether the machine running it has a live handshake file.
  it("is a silent no-op when disabled, even with a valid handshake file present", () => {
    writeValidHandshake();
    const log = vi.fn();
    const handshake = resolveDevMcpHandshake({
      command: "serve",
      existingToken: undefined,
      homeDir,
      disabled: true,
      log,
    });
    expect(handshake).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  // Regression for finding #4: because resolveDevMcpHandshake takes
  // existingToken/homeDir as plain arguments and the caller (vite.config.ts)
  // no longer writes the resolved token back into process.env, nothing about
  // an earlier call can taint a later one — a rotated token on the next
  // "restart" is picked up cleanly rather than being masked by a
  // previously-injected value.
  it("picks up a rotated token on a simulated dev-server restart", () => {
    writeValidHandshake(VALID_TOKEN);
    const first = resolveDevMcpHandshake({ command: "serve", existingToken: undefined, homeDir });
    expect(first?.token).toBe(VALID_TOKEN);

    // Backend restarts and rotates its token; handshake file is rewritten.
    writeValidHandshake(OTHER_TOKEN);
    const second = resolveDevMcpHandshake({ command: "serve", existingToken: undefined, homeDir });
    expect(second?.token).toBe(OTHER_TOKEN);
  });
});

describe("deriveMcpWsUrl", () => {
  // Regression for finding #3: the WS target must follow the handshake's
  // own host/port, not whatever VITE_AI_API_URL happens to say.
  it("derives the ws:// endpoint from the handshake's own url/port", () => {
    expect(
      deriveMcpWsUrl({ url: "http://127.0.0.1:3001/api/mcp", token: VALID_TOKEN, port: 3001 })
    ).toBe("ws://127.0.0.1:3001/api/mcp/ws");
  });

  it("follows a non-default port when the backend started on one", () => {
    expect(
      deriveMcpWsUrl({ url: "http://127.0.0.1:3002/api/mcp", token: VALID_TOKEN, port: 3002 })
    ).toBe("ws://127.0.0.1:3002/api/mcp/ws");
  });
});
