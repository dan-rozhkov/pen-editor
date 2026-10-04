import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/apiBase";
import { authClient } from "@/lib/auth/authClient";
import { describeScope } from "@/lib/auth/scopes";

import { AuthButton, FormMessage } from "./authUi";

interface AgentRow {
  id: string;
  clientId: string;
  name: string;
  scopes: string[];
}

async function fetchAgents(): Promise<AgentRow[] | null> {
  try {
    const res = await authClient.oauth2.getConsents();
    if (res.error) return null;
    return await Promise.all(
      (res.data ?? []).map(async (c): Promise<AgentRow> => {
        let name = c.clientId;
        try {
          const info = await authClient.oauth2.publicClient({ query: { client_id: c.clientId } });
          name = info.data?.client_name ?? name;
        } catch {
          // keep the raw client id
        }
        return { id: c.id, clientId: c.clientId, name, scopes: [...c.scopes] };
      }),
    );
  } catch {
    return null;
  }
}

// OAuth consents the user granted to agents (Codex, Claude Code, Cursor, …).
// Revoking goes through the backend (it also invalidates the agent's tokens,
// which deleting the consent alone would not); the agent has to sign in again.
export function ConnectedAgentsSection() {
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let live = true;
    void fetchAgents().then((rows) => {
      if (!live) return;
      setAgents(rows ?? []);
      if (!rows) setError("Could not load connected agents.");
    });
    return () => {
      live = false;
    };
  }, [tick]);

  async function revoke(rowId: string, clientId: string) {
    setBusyId(rowId);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch("/api/account/connected-agents/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      if (!res.ok) setError("Could not revoke access.");
      else setNotice("Access revoked. The agent must sign in again.");
      load();
    } catch {
      setError("Could not revoke access.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="agents-heading" className="flex flex-col gap-3">
      <h2 id="agents-heading" className="text-base font-semibold text-text-primary">
        Connected agents
      </h2>
      {error && <FormMessage kind="error">{error}</FormMessage>}
      {notice && <FormMessage kind="notice">{notice}</FormMessage>}
      {agents === null ? (
        <p role="status" className="text-sm text-text-muted">
          Loading…
        </p>
      ) : agents.length === 0 ? (
        <p className="text-sm text-text-muted">No agents are connected to your account.</p>
      ) : (
        <ul className="divide-y divide-border-default rounded-md border border-border-default">
          {agents.map((agent) => (
            <li key={agent.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-text-primary">{agent.name}</span>
                <span className="block truncate text-xs text-text-muted">
                  {agent.scopes.map(describeScope).join(", ")}
                </span>
              </span>
              <AuthButton
                variant="secondary"
                disabled={busyId === agent.id}
                aria-label={`Revoke access for ${agent.name}`}
                onClick={() => void revoke(agent.id, agent.clientId)}
              >
                Revoke access
              </AuthButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
