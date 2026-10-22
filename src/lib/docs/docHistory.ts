/** In-memory back/forward history of document ids for one /doc tab. */
export interface DocHistory {
  back: string[];
  forward: string[];
}

export const EMPTY_DOC_HISTORY: DocHistory = { back: [], forward: [] };

const MAX_ENTRIES = 100;

/** Switching from `current` to another document: remember `current`, drop forward. */
export function pushDoc(h: DocHistory, current: string | null, next: string): DocHistory {
  if (current === null || current === next) return h;
  return { back: [...h.back, current].slice(-MAX_ENTRIES), forward: [] };
}

/** Ids that can still be reached; `current` itself and missing documents do not count. */
function reachable(stack: string[], current: string | null, exists: (id: string) => boolean): string[] {
  return stack.filter((id) => id !== current && exists(id));
}

export function canStep(stack: string[], current: string | null, exists: (id: string) => boolean): boolean {
  return reachable(stack, current, exists).length > 0;
}

export interface DocHistoryStep {
  history: DocHistory;
  /** Document to open. */
  target: string;
}

function step(from: string[], other: string[], current: string | null, exists: (id: string) => boolean) {
  const live = reachable(from, current, exists);
  const target = live[live.length - 1];
  if (target === undefined) return null;
  const rest = live.slice(0, -1);
  return { target, rest, other: current !== null ? [...other, current].slice(-MAX_ENTRIES) : other };
}

export function goBackDoc(h: DocHistory, current: string | null, exists: (id: string) => boolean): DocHistoryStep | null {
  const s = step(h.back, h.forward, current, exists);
  return s && { target: s.target, history: { back: s.rest, forward: s.other } };
}

export function goForwardDoc(h: DocHistory, current: string | null, exists: (id: string) => boolean): DocHistoryStep | null {
  const s = step(h.forward, h.back, current, exists);
  return s && { target: s.target, history: { back: s.other, forward: s.rest } };
}
