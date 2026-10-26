import { useCallback, useEffect, useRef, useState } from "react";

import { TrashIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  clearAgentMemory,
  deleteMemoryEntry,
  fetchAgentMemory,
  setAgentMemoryEnabled,
  type AgentMemory,
  type MemoryTarget,
} from "@/lib/agentMemoryApi";
import { useIdentityKey } from "@/lib/auth/useIdentityKey";

import { SettingsGroup, SettingsSection } from "../SettingsSection";

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; memory: AgentMemory };

function EntryList({
  title,
  target,
  entries,
  disabled,
  onDelete,
}: {
  title: string;
  target: MemoryTarget;
  entries: string[];
  disabled: boolean;
  onDelete: (target: MemoryTarget, index: number) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <SettingsGroup title={title}>
      <ul className="flex flex-col gap-1.5">
        {entries.map((text, index) => (
          // Duplicates are legal, so the index is part of the key.
          <li
            key={`${index}:${text}`}
            className="flex items-start justify-between gap-3 rounded-control border border-border-default px-3 py-2"
          >
            <span className="min-w-0 text-sm break-words whitespace-pre-wrap text-text-primary">{text}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete memory: ${text.slice(0, 60)}`}
              disabled={disabled}
              onClick={() => onDelete(target, index)}
            >
              <TrashIcon />
            </Button>
          </li>
        ))}
      </ul>
    </SettingsGroup>
  );
}

function MemoryBody() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // One write at a time: while it is in flight every write control is disabled,
  // so results can never interleave (a late failure re-adding what Clear removed).
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const busyRef = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    void fetchAgentMemory().then((res) => {
      if (!live) return;
      setLoad(res.ok ? { status: "ready", memory: res.data } : { status: "error" });
    });
    return () => {
      live = false;
    };
  }, [tick]);

  const retry = useCallback(() => {
    setLoad({ status: "loading" });
    setTick((t) => t + 1);
  }, []);

  const patch = (fn: (m: AgentMemory) => AgentMemory) =>
    setLoad((cur) => (cur.status === "ready" ? { status: "ready", memory: fn(cur.memory) } : cur));

  /** Runs one write; false when another is in flight. Results apply only while mounted. */
  async function write(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const toggle = (enabled: boolean, previous: boolean) =>
    write(async () => {
      patch((m) => ({ ...m, enabled }));
      const res = await setAgentMemoryEnabled(enabled);
      // The identity changed meanwhile (this body was remounted): nothing to update.
      if (!alive.current) return;
      if (!res.ok) {
        patch((m) => ({ ...m, enabled: previous }));
        setActionError("Could not change this setting.");
      }
    });

  const remove = (target: MemoryTarget, index: number) =>
    write(async () => {
      if (load.status !== "ready") return;
      const text = load.memory[target][index];
      if (text === undefined) return;
      patch((m) => ({ ...m, [target]: m[target].filter((_, i) => i !== index) }));
      const res = await deleteMemoryEntry(target, text);
      if (!alive.current) return;
      // 404: already gone on the server, so the removal stands.
      if (!res.ok && res.status !== 404) {
        patch((m) => ({ ...m, [target]: [...m[target].slice(0, index), text, ...m[target].slice(index)] }));
        setActionError("Could not delete that entry.");
      }
    });

  const clearAll = () =>
    write(async () => {
      const res = await clearAgentMemory();
      if (!alive.current) return;
      setConfirmClear(false);
      if (res.ok) patch((m) => ({ ...m, memory: [], user: [] }));
      else setActionError("Could not clear memory.");
    });

  let body;
  if (load.status === "loading") {
    body = (
      <p role="status" className="py-5 text-sm text-text-muted">
        Loading…
      </p>
    );
  } else if (load.status === "error") {
    body = (
      <div role="alert" className="flex items-center justify-between gap-4 py-5">
        <p className="text-sm text-text-muted">Could not load the agent's memory.</p>
        <Button variant="outline" onClick={retry}>
          Retry
        </Button>
      </div>
    );
  } else if (!load.memory.available) {
    body = <p className="py-5 text-sm text-text-muted">Memory is turned off on this server.</p>;
  } else {
    const { memory } = load;
    const empty = memory.user.length === 0 && memory.memory.length === 0;
    body = (
      <>
        <SettingsGroup
          inline
          title="Agent remembers"
          description="When off, the agent does not read or add memories. Saved ones stay until you delete them."
        >
          <Switch
            aria-label="Agent remembers"
            checked={memory.enabled}
            disabled={busy}
            onCheckedChange={(next) => void toggle(next, memory.enabled)}
          />
        </SettingsGroup>
        {empty && <p className="py-5 text-sm text-text-muted">The agent has not saved anything yet.</p>}
        <EntryList title="About you" target="user" entries={memory.user} disabled={busy} onDelete={(t, i) => void remove(t, i)} />
        <EntryList title="Notes" target="memory" entries={memory.memory} disabled={busy} onDelete={(t, i) => void remove(t, i)} />
        {!empty && (
          <SettingsGroup
            inline
            title="Clear all"
            description={confirmClear ? "This deletes every saved memory. It cannot be undone." : "Delete every saved memory."}
          >
            {confirmClear ? (
              <div className="flex items-center gap-2">
                <Button variant="outline" disabled={busy} onClick={() => setConfirmClear(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" disabled={busy} onClick={() => void clearAll()}>
                  Delete all
                </Button>
              </div>
            ) : (
              <Button variant="destructive" disabled={busy} onClick={() => setConfirmClear(true)}>
                Clear all
              </Button>
            )}
          </SettingsGroup>
        )}
        {actionError && (
          <p role="alert" className="py-3 text-xs text-destructive">
            {actionError}
          </p>
        )}
      </>
    );
  }

  return body;
}

/**
 * Waits until the identity is known (auth config + session resolved) and
 * remounts the body whenever it changes, so every fetch and write is made as
 * the identity the user sees; Clear / the switch never hit another one.
 */
export function MemorySection() {
  const identity = useIdentityKey();
  return (
    <SettingsSection title="Agent memory">
      <p className="pb-4 text-sm text-text-muted">The agent remembers facts about you and your work across chats.</p>
      {identity === null ? (
        <p role="status" className="py-5 text-sm text-text-muted">
          Loading…
        </p>
      ) : (
        <MemoryBody key={identity} />
      )}
    </SettingsSection>
  );
}
