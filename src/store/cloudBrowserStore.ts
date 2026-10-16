import { create } from "zustand";

/**
 * Live-view info for a chat's cloud browser session, filled from every
 * `POST /api/browser/cmd/:name` response (src/lib/cloudBrowser.ts) and read
 * by CloudBrowserPanel. Keyed by chat id because several chats can run in
 * parallel, each with its own remote browser. Mirrored to sessionStorage so a
 * reload keeps showing the live view of a session the handle still reaches.
 */
export interface CloudBrowserSession {
  liveViewUrl: string;
  /** Epoch ms after which the backend/Steel will have dropped the session. */
  expiresAt: number | null;
  /** Epoch ms of the last successful command. */
  lastUsedAt?: number;
  /** Backend idle timeout: the session is reaped `idleMs` after last use. */
  idleMs?: number;
}

interface CloudBrowserState {
  sessions: Record<string, CloudBrowserSession>;
  setSession: (chatId: string, session: CloudBrowserSession) => void;
  clearSession: (chatId: string) => void;
}

const LIVE_PREFIX = "pen.cloudBrowserLive.";

/** Epoch ms after which the live view is dead; null when nothing bounds it. */
export function getSessionStaleAt(session: CloudBrowserSession): number | null {
  const bounds: number[] = [];
  if (typeof session.expiresAt === "number") bounds.push(session.expiresAt);
  if (typeof session.lastUsedAt === "number" && typeof session.idleMs === "number") {
    bounds.push(session.lastUsedAt + session.idleMs);
  }
  return bounds.length > 0 ? Math.min(...bounds) : null;
}

function persist(chatId: string, session: CloudBrowserSession | null): void {
  try {
    if (session) sessionStorage.setItem(LIVE_PREFIX + chatId, JSON.stringify(session));
    else sessionStorage.removeItem(LIVE_PREFIX + chatId);
  } catch {
    // Storage blocked: the in-memory store still covers this page's lifetime.
  }
}

function parseSession(raw: string | null): CloudBrowserSession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<CloudBrowserSession> | null;
    if (!v || typeof v.liveViewUrl !== "string" || v.liveViewUrl === "") return null;
    return {
      liveViewUrl: v.liveViewUrl,
      expiresAt: typeof v.expiresAt === "number" ? v.expiresAt : null,
      ...(typeof v.lastUsedAt === "number" ? { lastUsedAt: v.lastUsedAt } : {}),
      ...(typeof v.idleMs === "number" ? { idleMs: v.idleMs } : {}),
    };
  } catch {
    return null;
  }
}

/** Reads every persisted live-view entry back (stale ones included: the panel expires them). */
export function readPersistedSessions(): Record<string, CloudBrowserSession> {
  const out: Record<string, CloudBrowserSession> = {};
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith(LIVE_PREFIX)) continue;
      const session = parseSession(sessionStorage.getItem(key));
      if (session) out[key.slice(LIVE_PREFIX.length)] = session;
    }
  } catch {
    // ignore
  }
  return out;
}

export const useCloudBrowserStore = create<CloudBrowserState>((set) => ({
  sessions: readPersistedSessions(),
  setSession: (chatId, session) => {
    persist(chatId, session);
    set((s) => ({ sessions: { ...s.sessions, [chatId]: session } }));
  },
  clearSession: (chatId) => {
    persist(chatId, null);
    set((s) => {
      if (!(chatId in s.sessions)) return s;
      const sessions = { ...s.sessions };
      delete sessions[chatId];
      return { sessions };
    });
  },
}));

/** Re-reads sessionStorage into the store (used after a reload, and by tests). */
export function rehydrateCloudBrowserSessions(): void {
  useCloudBrowserStore.setState({ sessions: readPersistedSessions() });
}
