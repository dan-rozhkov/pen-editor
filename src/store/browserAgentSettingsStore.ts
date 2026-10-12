import { create } from "zustand";

const STORAGE_KEY = "pen.browserAgentSettings";

/** User switches that gate what the browser agent (`browse_task`) may do. */
export interface BrowserAgentPermissions {
  /** The agent may type a password, but only one the user gave in the chat. */
  allowPasswordEntry: boolean;
  /** The agent stops and asks before irreversible actions it was not told to do. */
  confirmIrreversible: boolean;
}

export const DEFAULT_BROWSER_AGENT_PERMISSIONS: BrowserAgentPermissions = {
  allowPasswordEntry: false,
  confirmIrreversible: true,
};

function readPersisted(): BrowserAgentPermissions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BROWSER_AGENT_PERMISSIONS };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_BROWSER_AGENT_PERMISSIONS };
    const p = parsed as Record<string, unknown>;
    return {
      allowPasswordEntry:
        typeof p.allowPasswordEntry === "boolean"
          ? p.allowPasswordEntry
          : DEFAULT_BROWSER_AGENT_PERMISSIONS.allowPasswordEntry,
      confirmIrreversible:
        typeof p.confirmIrreversible === "boolean"
          ? p.confirmIrreversible
          : DEFAULT_BROWSER_AGENT_PERMISSIONS.confirmIrreversible,
    };
  } catch {
    return { ...DEFAULT_BROWSER_AGENT_PERMISSIONS };
  }
}

function persist(value: BrowserAgentPermissions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage can be blocked or full; the in-memory value still applies.
  }
}

interface BrowserAgentSettingsState extends BrowserAgentPermissions {
  setAllowPasswordEntry: (value: boolean) => void;
  setConfirmIrreversible: (value: boolean) => void;
}

export const useBrowserAgentSettingsStore = create<BrowserAgentSettingsState>((set) => ({
  ...readPersisted(),
  setAllowPasswordEntry: (allowPasswordEntry) => {
    // Merge over the latest stored value, not memory: another tab may have
    // changed the other key since this one loaded.
    const next = { ...readPersisted(), allowPasswordEntry };
    set(next);
    persist(next);
  },
  setConfirmIrreversible: (confirmIrreversible) => {
    const next = { ...readPersisted(), confirmIrreversible };
    set(next);
    persist(next);
  },
}));

// Another tab/window changed the key: adopt it.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    useBrowserAgentSettingsStore.setState(readPersisted());
  });
}

function pick(s: BrowserAgentPermissions): BrowserAgentPermissions {
  return { allowPasswordEntry: s.allowPasswordEntry, confirmIrreversible: s.confirmIrreversible };
}

/** Current permissions, readable outside React (read at request time, never cached). */
export function getBrowserAgentPermissions(): BrowserAgentPermissions {
  return pick(useBrowserAgentSettingsStore.getState());
}
