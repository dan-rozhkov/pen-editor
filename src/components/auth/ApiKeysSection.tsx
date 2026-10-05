import { useCallback, useEffect, useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth/authClient";

import { AuthButton, FormMessage, TextField } from "./authUi";

interface KeyRow {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: Date | string;
}

async function fetchKeys(): Promise<KeyRow[] | null> {
  try {
    const res = await authClient.apiKey.list();
    if (res.error) return null;
    return (res.data?.apiKeys ?? []) as KeyRow[];
  } catch {
    return null;
  }
}

// Personal API keys (`sf_…`) for agents that cannot do the OAuth flow. The full
// key exists only in the create response — shown once, never listed again.
export function ApiKeysSection() {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ id: string | null; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let live = true;
    void fetchKeys().then((rows) => {
      if (!live) return;
      setKeys(rows ?? []);
      if (!rows) setError("Could not load API keys.");
    });
    return () => {
      live = false;
    };
  }, [tick]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await authClient.apiKey.create({ name: name.trim() || "API key" });
      if (res.error || !res.data) {
        setError("Could not create the key.");
      } else {
        setCreated({ id: res.data.id ?? null, key: res.data.key });
        setName("");
        load();
      }
    } catch {
      setError("Could not create the key.");
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.apiKey.delete({ keyId: id });
      if (res.error) setError("Could not revoke the key.");
      else setCreated((c) => (c && c.id === id ? null : c)); // only the revoked key's reveal goes
      setConfirmId(null);
      load();
    } catch {
      setError("Could not revoke the key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="api-keys-heading" className="flex flex-col gap-3">
      <h2 id="api-keys-heading" className="text-base font-semibold text-text-primary">
        API keys
      </h2>
      <p className="text-sm text-text-muted">
        Use a key as a bearer token for agents that cannot sign in with OAuth.
      </p>
      <form onSubmit={onCreate} className="flex items-end gap-2">
        <div className="flex-1">
          <TextField
            label="Key name"
            name="key-name"
            placeholder="e.g. Cursor on my laptop"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <AuthButton type="submit" disabled={busy}>
          Create key
        </AuthButton>
      </form>
      {created && (
        <div role="status" className="rounded-md bg-surface-elevated p-3 text-sm">
          <p className="mb-1 text-text-primary">Copy this key now. It is shown only once.</p>
          <code className="block break-all rounded bg-surface-panel p-2 text-xs text-text-primary">
            {created.key}
          </code>
          <AuthButton
            variant="secondary"
            className="mt-2"
            onClick={() => void navigator.clipboard?.writeText(created.key)}
          >
            Copy
          </AuthButton>
        </div>
      )}
      {error && <FormMessage kind="error">{error}</FormMessage>}
      {keys === null ? (
        <p role="status" className="text-sm text-text-muted">
          Loading…
        </p>
      ) : keys.length === 0 ? (
        <p className="text-sm text-text-muted">No API keys yet.</p>
      ) : (
        <ul className="divide-y divide-border-default rounded-md border border-border-default">
          {keys.map((key) => (
            <li key={key.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 truncate text-text-primary">
                {key.name ?? "API key"}
                {key.start && <span className="ml-2 text-xs text-text-muted">{key.start}…</span>}
              </span>
              {confirmId === key.id ? (
                <span className="flex shrink-0 gap-2">
                  <AuthButton variant="danger" disabled={busy} onClick={() => void onRevoke(key.id)}>
                    Confirm revoke
                  </AuthButton>
                  <AuthButton variant="secondary" onClick={() => setConfirmId(null)}>
                    Cancel
                  </AuthButton>
                </span>
              ) : (
                <AuthButton
                  variant="secondary"
                  aria-label={`Revoke ${key.name ?? "API key"}`}
                  onClick={() => setConfirmId(key.id)}
                >
                  Revoke
                </AuthButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
