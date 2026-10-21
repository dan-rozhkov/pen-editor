import { create } from "zustand";
import {
  MIN_REDACTED_SECRET_LENGTH,
  SECRET_NAME_PATTERN,
  createSecretRedactor,
} from "@sideform/browser-agent/agent/execute";
import { useBrowseCheckpointStore } from "./browseCheckpointStore";

/**
 * Passwords the user hands to the browser agent, per chat. The model only ever
 * sees the placeholder `{{secret:<name>}}`; the package executor puts the value
 * in right before the bridge call and redacts it out of every tool result.
 *
 * SECRETS: `value` is a real password. This store is in-memory ONLY: no
 * `persist`, never localStorage / IndexedDB, never sent to the backend (only
 * the names go, as `browseSecrets`), never read by the model, a log, the chat
 * export or analytics. A reload loses every secret on purpose.
 *
 * A removed or replaced value moves to `retired` until the chat is cleared. It is
 * used for REDACTION only: the page, the browser history or a transcript may still hold it.
 */
export const MAX_SECRETS_PER_CHAT = 20;
/** Shorter values would corrupt unrelated page text once redacted. */
export const MIN_SECRET_LENGTH = Math.max(6, MIN_REDACTED_SECRET_LENGTH);

export interface BrowseSecret {
  name: string;
  value: string;
}

export type SetSecretResult = { ok: true } | { ok: false; error: string };

interface BrowseSecretState {
  byChat: Record<string, BrowseSecret[]>;
  /** Removed or replaced values per chat; redaction only. */
  retired: Record<string, BrowseSecret[]>;
  /** Adds a secret, or replaces the one with the same name. */
  set: (chatId: string, name: string, value: string) => SetSecretResult;
  remove: (chatId: string, name: string) => void;
  clearChat: (chatId: string) => void;
  /** Names only: safe to send to the backend and to show. */
  namesFor: (chatId: string) => string[];
  /** `{ name: value }` for the executor. Never show or log it. */
  valuesFor: (chatId: string) => Record<string, string>;
}

export const useBrowseSecretStore = create<BrowseSecretState>((set, getState) => {
  /**
   * The old value leaves use: the chat's checkpoints hold it (their fixture journal), so they go,
   * and it joins `retired`. Runs outside any `set` updater.
   */
  const retire = (chatId: string, old: BrowseSecret) => {
    useBrowseCheckpointStore.getState().clearChat(chatId);
    set((s) => ({ retired: { ...s.retired, [chatId]: [...(s.retired[chatId] ?? []), old] } }));
  };
  return {
    byChat: {},
    retired: {},
    set: (chatId, name, value) => {
      if (!SECRET_NAME_PATTERN.test(name)) {
        return { ok: false, error: "Name: 1-40 letters, digits, - or _." };
      }
      if (value.length < MIN_SECRET_LENGTH) {
        return { ok: false, error: `Password must be at least ${MIN_SECRET_LENGTH} characters.` };
      }
      const list = getState().byChat[chatId] ?? [];
      const old = list.find((s) => s.name === name);
      if (!old && list.length >= MAX_SECRETS_PER_CHAT) {
        return { ok: false, error: `At most ${MAX_SECRETS_PER_CHAT} passwords per chat.` };
      }
      if (old && old.value !== value) retire(chatId, old);
      const next = old ? list.map((s) => (s.name === name ? { name, value } : s)) : [...list, { name, value }];
      set((s) => ({ byChat: { ...s.byChat, [chatId]: next } }));
      return { ok: true };
    },
    remove: (chatId, name) => {
      const list = getState().byChat[chatId];
      const old = list?.find((x) => x.name === name);
      if (!list || !old) return;
      retire(chatId, old);
      const next = list.filter((x) => x.name !== name);
      set((s) => {
        const byChat = { ...s.byChat };
        if (next.length > 0) byChat[chatId] = next;
        else delete byChat[chatId];
        return { byChat };
      });
    },
    clearChat: (chatId) =>
      set((s) => {
        if (!(chatId in s.byChat) && !(chatId in s.retired)) return s;
        const byChat = { ...s.byChat };
        const retired = { ...s.retired };
        delete byChat[chatId];
        delete retired[chatId];
        return { byChat, retired };
      }),
    namesFor: (chatId) => (getState().byChat[chatId] ?? []).map((s) => s.name),
    valuesFor: (chatId) => Object.fromEntries((getState().byChat[chatId] ?? []).map((s) => [s.name, s.value])),
  };
});

/** Request-body extra for the backend: the chat's secret NAMES, omitted when there are none. */
export function secretNamesBody(chatId: string | undefined): { browseSecrets?: string[] } {
  const names = chatId ? useBrowseSecretStore.getState().namesFor(chatId) : [];
  return names.length > 0 ? { browseSecrets: names } : {};
}

/**
 * Every secret of every chat plus the retired values, as `{ name: value }` layers: the redactor
 * keys by name, and two chats may share one, so a repeated name opens the next layer.
 * Used for REDACTION only (the desktop browser is shared across chats, and MCP/WebMCP callers
 * have no chat id). Empty when nothing is stored.
 */
function redactionLayers(): Record<string, string>[] {
  const { byChat, retired } = useBrowseSecretStore.getState();
  const layers: Record<string, string>[] = [];
  const seen = new Set<string>();
  for (const entry of [...Object.values(byChat).flat(), ...Object.values(retired).flat()]) {
    const key = `${entry.name}\u0000${entry.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let layer = layers.find((l) => !(entry.name in l));
    if (!layer) layers.push((layer = {}));
    layer[entry.name] = entry.value;
  }
  return layers;
}

/**
 * Removes every stored secret value from a tool result (`"output"`: JSON string, redacted
 * structurally) or a plain string such as captured HTML (`"text"`). Returns the input as is
 * when no secret exists.
 */
export function redactAllSecrets(s: string, mode: "output" | "text" = "output"): string {
  const layers = redactionLayers();
  let out = s;
  for (const layer of layers) {
    const redactor = createSecretRedactor(layer);
    out = mode === "output" ? redactor.output(out) : redactor.text(out);
  }
  return out;
}

/** Test helper: forget every secret. */
export function resetBrowseSecrets(): void {
  useBrowseSecretStore.setState({ byChat: {}, retired: {} });
}
