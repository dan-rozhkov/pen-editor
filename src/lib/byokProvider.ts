// The single point of contact for the user's custom OpenAI-compatible
// provider (pen-editor-backend docs/specs/2026-11-13-byok-custom-provider-
// design.md). Base URL, API key and the added model list live in ONE
// localStorage key; nothing else in the app touches it. The key and base URL
// leave the browser only as the `X-BYOK-Key` / `X-BYOK-Base-URL` headers on a
// turn that runs a `byok/` model (see chatTransport.ts) and on the "Load
// models" call — never in a request body.
//
// Every storage access is wrapped in try/catch: private mode and locked-down
// embeds throw on getItem/setItem. A failed read behaves as "not configured",
// a failed write does not pretend to have saved.

import { onStorageKey } from "@/lib/storageSync";

const BYOK_STORAGE_KEY = "pen.byok.v1";
export const BYOK_MODEL_PREFIX = "byok/";

export interface ByokModel {
  id: string;
  contextWindow?: number;
}

export interface ByokConfig {
  baseUrl: string;
  apiKey: string;
  models: ByokModel[];
}

export interface ByokPreset {
  id: string;
  label: string;
  baseUrl: string;
}

export const BYOK_PRESETS: readonly ByokPreset[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { id: "together", label: "Together", baseUrl: "https://api.together.xyz/v1" },
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1" },
  { id: "custom", label: "Custom", baseUrl: "" },
];

const EMPTY: ByokConfig = Object.freeze({ baseUrl: "", apiKey: "", models: [] }) as ByokConfig;

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedConfig: ByokConfig = EMPTY;
// While true, `cachedConfig` is current and getByokConfig skips the
// localStorage read. notify() runs on every local write and on another
// document's `storage` event, so it is the one place that invalidates.
let cacheValid = false;

function notify(): void {
  cacheValid = false;
  for (const listener of listeners) listener();
}

/**
 * Parses a raw model list (stored or fetched): trims ids, drops blanks and
 * duplicates, keeps only a finite positive numeric contextWindow.
 */
export function normalizeByokModels(raw: unknown): ByokModel[] {
  if (!Array.isArray(raw)) return [];
  const models: ByokModel[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const m = item as Record<string, unknown>;
    if (typeof m.id !== "string") continue;
    const id = m.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const cw = m.contextWindow;
    models.push(typeof cw === "number" && Number.isFinite(cw) && cw > 0 ? { id, contextWindow: cw } : { id });
  }
  return models;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Validates and normalizes a provider base URL: https only (http only for a
 * loopback host, for local dev), no credentials, no query or fragment.
 * Returns `url.href` minus a trailing slash (which also punycodes IDN hosts,
 * keeping the value header-safe), or null when invalid.
 */
export function normalizeByokBaseUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const httpsOk = url.protocol === "https:";
  const httpOk = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (!httpsOk && !httpOk) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return url.href.replace(/\/+$/, "");
}

/** Whether `value` is non-empty visible ASCII (0x21-0x7E), safe as a header value. */
export function isHeaderSafe(value: string): boolean {
  return /^[\x21-\x7e]+$/.test(value);
}

function parseConfig(raw: string): ByokConfig {
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return EMPTY;
    const rec = data as Record<string, unknown>;
    const baseUrl = typeof rec.baseUrl === "string" ? rec.baseUrl.trim() : "";
    const apiKey = typeof rec.apiKey === "string" ? rec.apiKey.trim() : "";
    return { baseUrl, apiKey, models: normalizeByokModels(rec.models) };
  } catch {
    return EMPTY;
  }
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(BYOK_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeConfig(next: ByokConfig): void {
  try {
    if (!next.baseUrl && !next.apiKey && next.models.length === 0) {
      localStorage.removeItem(BYOK_STORAGE_KEY);
    } else {
      localStorage.setItem(BYOK_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // A failed write leaves storage as it was; getByokConfig re-reads it.
  }
  notify();
}

/**
 * The stored config. Returns the SAME object while the stored string is
 * unchanged, so it is safe as a `useSyncExternalStore` snapshot. Never throws.
 */
export function getByokConfig(): ByokConfig {
  if (cacheValid) return cachedConfig;
  const raw = readRaw();
  cacheValid = true;
  if (raw === cachedRaw) return cachedConfig;
  cachedRaw = raw;
  cachedConfig = raw ? parseConfig(raw) : EMPTY;
  return cachedConfig;
}

/**
 * Saves base URL and key (both trimmed). The model list is kept when only the
 * key changes and dropped when the base URL changes: another provider's model
 * ids do not exist on the new endpoint.
 */
export function setByokConnection(baseUrl: string, apiKey: string): void {
  const current = getByokConfig();
  const nextUrl = baseUrl.trim();
  const models = nextUrl === current.baseUrl ? current.models : [];
  writeConfig({ baseUrl: nextUrl, apiKey: apiKey.trim(), models });
}

/** Adds a model; a blank id or an id already present is ignored. */
export function addByokModel(model: ByokModel): void {
  const id = model.id.trim();
  if (!id) return;
  const current = getByokConfig();
  if (current.models.some((m) => m.id === id)) return;
  const entry: ByokModel =
    typeof model.contextWindow === "number" && model.contextWindow > 0
      ? { id, contextWindow: model.contextWindow }
      : { id };
  writeConfig({ ...current, models: [...current.models, entry] });
}

export function removeByokModel(id: string): void {
  const current = getByokConfig();
  if (!current.models.some((m) => m.id === id)) return;
  writeConfig({ ...current, models: current.models.filter((m) => m.id !== id) });
}

/** Removes everything: URL, key and models. */
export function clearByokConfig(): void {
  try {
    localStorage.removeItem(BYOK_STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
  notify();
}

/** Whether both base URL and key are non-blank. */
export function isByokConfigured(): boolean {
  const { baseUrl, apiKey } = getByokConfig();
  return baseUrl.trim() !== "" && apiKey.trim() !== "";
}

export function isByokModel(value: string): boolean {
  return value.startsWith(BYOK_MODEL_PREFIX);
}

export function byokModelValue(id: string): string {
  return `${BYOK_MODEL_PREFIX}${id}`;
}

onStorageKey(BYOK_STORAGE_KEY, notify);

export function subscribeByok(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
