import { useMemo, useRef, useState, useSyncExternalStore } from "react";

import { XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/apiBase";
import {
  addByokModel,
  BYOK_PRESETS,
  clearByokConfig,
  getByokConfig,
  isByokConfigured,
  isHeaderSafe,
  normalizeByokBaseUrl,
  normalizeByokModels,
  removeByokModel,
  setByokConnection,
  subscribeByok,
  type ByokModel,
} from "@/lib/byokProvider";

import { SettingsGroup } from "../SettingsSection";

const LOAD_TIMEOUT_MS = 20_000;

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; models: ByokModel[] };

const REASON_MESSAGES: Record<string, string> = {
  invalid_key: "The provider rejected this key.",
  no_model_list: "This provider has no model list. Add a model ID manually.",
  upstream_error: "Could not reach the provider. Check the base URL.",
};

function presetForUrl(baseUrl: string): string {
  const match = BYOK_PRESETS.find((p) => p.baseUrl !== "" && p.baseUrl === baseUrl.trim());
  return match?.id ?? "custom";
}

/**
 * Settings group for the user's own OpenAI-compatible provider. All storage
 * goes through src/lib/byokProvider.ts; the key rides only as a header on the
 * "Load models" call (and later on `byok/` chat turns).
 */
export function CustomProviderGroup() {
  const config = useSyncExternalStore(subscribeByok, getByokConfig, getByokConfig);
  const [presetId, setPresetId] = useState(() => presetForUrl(config.baseUrl));
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [load, setLoad] = useState<LoadState>({ kind: "idle" });
  const [filter, setFilter] = useState("");
  const [manualId, setManualId] = useState("");
  // Blocks a second concurrent request; a ref reads synchronously, unlike state.
  const loadingRef = useRef(false);
  // Each request gets a number; a response for an older one is dropped.
  const requestRef = useRef(0);

  // Another tab (or Remove) changed the stored connection: show the stored
  // values instead of stale inputs. Adjusting state during render, per React's
  // "adjusting state when a prop changes" pattern. A local Save lands here too,
  // but then the inputs already match and the loaded list is left alone.
  const [seenConfig, setSeenConfig] = useState(config);
  if (config.baseUrl !== seenConfig.baseUrl || config.apiKey !== seenConfig.apiKey) {
    setSeenConfig(config);
    if (config.baseUrl !== baseUrl.trim() || config.apiKey !== apiKey.trim()) {
      setBaseUrl(config.baseUrl);
      setApiKey(config.apiKey);
      setPresetId(presetForUrl(config.baseUrl));
      setLoad({ kind: "idle" });
      setFilter("");
    }
  }

  const url = baseUrl.trim();
  const key = apiKey.trim();
  const normalizedUrl = url === "" ? null : normalizeByokBaseUrl(url);
  const keyOk = key !== "" && isHeaderSafe(key);
  const urlError = url !== "" && normalizedUrl === null ? "Base URL must be a public https:// address." : null;
  const keyError = key !== "" && !keyOk ? "The key contains characters that can't be sent. Paste it again." : null;
  // The validated pair, or null: every action that needs a connection reads it.
  const connection = normalizedUrl !== null && keyOk ? { url: normalizedUrl, key } : null;
  const canLoad = connection !== null && load.kind !== "loading";
  const hasAnything = config.baseUrl !== "" || config.apiKey !== "" || config.models.length > 0;
  const added = useMemo(() => new Set(config.models.map((m) => m.id)), [config.models]);

  // Whatever the loaded list described no longer applies once URL or key change.
  const invalidateLoad = () => {
    requestRef.current += 1;
    loadingRef.current = false;
    setLoad({ kind: "idle" });
    setFilter("");
  };

  // Models can only run once the connection is stored, so adding one also
  // saves whatever is typed. Returns false (and saves nothing) without a
  // valid connection.
  const ensureConnectionSaved = (): boolean => {
    if (!connection) return false;
    if (baseUrl.trim() !== connection.url) setBaseUrl(connection.url);
    if (connection.url !== config.baseUrl || connection.key !== config.apiKey) {
      setByokConnection(connection.url, connection.key);
    }
    return true;
  };

  const handleSave = () => {
    if (!connection) return;
    setBaseUrl(connection.url);
    setPresetId(presetForUrl(connection.url));
    setByokConnection(connection.url, connection.key);
  };

  const handleRemove = () => {
    requestRef.current += 1;
    loadingRef.current = false;
    clearByokConfig();
    setBaseUrl("");
    setApiKey("");
    setPresetId("custom");
    setLoad({ kind: "idle" });
    setFilter("");
    setManualId("");
  };

  const handlePreset = (next: string | null) => {
    if (!next) return;
    setPresetId(next);
    const preset = BYOK_PRESETS.find((p) => p.id === next);
    if (preset && preset.baseUrl) {
      setBaseUrl(preset.baseUrl);
      invalidateLoad();
    }
  };

  const handleLoad = async () => {
    if (!connection || !canLoad || loadingRef.current) return;
    loadingRef.current = true;
    const requestId = ++requestRef.current;
    setLoad({ kind: "loading" });
    setFilter("");
    const settle = (next: LoadState) => {
      if (requestRef.current === requestId) setLoad(next);
    };
    try {
      const res = await apiFetch("/api/byok/models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BYOK-Base-URL": connection.url,
          "X-BYOK-Key": connection.key,
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(LOAD_TIMEOUT_MS),
      });
      const data = (await res.json().catch(() => undefined)) as
        | { ok?: boolean; reason?: string; models?: unknown; code?: string }
        | undefined;
      if (res.status === 429) {
        settle({ kind: "error", message: "Too many requests. Try again in a minute." });
      } else if (data?.code === "byok_base_url_invalid") {
        settle({ kind: "error", message: "Base URL must be a public https:// address." });
      } else if (data?.ok === true) {
        settle({ kind: "loaded", models: normalizeByokModels(data.models) });
      } else {
        settle({ kind: "error", message: REASON_MESSAGES[data?.reason ?? ""] ?? REASON_MESSAGES.upstream_error });
      }
    } catch {
      settle({ kind: "error", message: REASON_MESSAGES.upstream_error });
    } finally {
      if (requestRef.current === requestId) loadingRef.current = false;
    }
  };

  const handleAdd = (model: ByokModel) => {
    if (!ensureConnectionSaved()) return;
    addByokModel(model);
  };

  const manualTrimmed = manualId.trim();
  const manualDisabled = connection === null || manualTrimmed === "" || added.has(manualTrimmed);
  const handleManualAdd = () => {
    if (manualDisabled) return;
    handleAdd({ id: manualTrimmed });
    setManualId("");
  };

  const needle = filter.trim().toLowerCase();
  const visibleModels =
    load.kind === "loaded" ? load.models.filter((m) => m.id.toLowerCase().includes(needle)) : [];

  return (
    <SettingsGroup
      title="Custom provider"
      description="Use your own API key with any OpenAI-compatible endpoint. The key stays in this browser."
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span id="byok-preset-label" className="text-xs text-text-muted">
            Provider
          </span>
          <Select value={presetId} onValueChange={handlePreset}>
            <SelectTrigger aria-labelledby="byok-preset-label" className="w-52">
              <SelectValue>{BYOK_PRESETS.find((p) => p.id === presetId)?.label ?? "Custom"}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="start" className="w-52">
              {BYOK_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-muted">Base URL</span>
          <Input
            type="url"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setPresetId(presetForUrl(e.target.value));
              invalidateLoad();
            }}
            placeholder="https://api.example.com/v1"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-muted">API key</span>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              invalidateLoad();
            }}
            placeholder="sk-…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="accent" onClick={handleSave} disabled={connection === null}>
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={() => void handleLoad()} disabled={!canLoad}>
            {load.kind === "loading" ? "Loading…" : "Load models"}
          </Button>
          {hasAnything && (
            <Button size="sm" variant="destructive" onClick={handleRemove}>
              Remove
            </Button>
          )}
        </div>

        <p role="status" className="text-xs text-text-muted empty:hidden">
          {isByokConfigured() ? "Connection saved in this browser." : ""}
        </p>
        {(urlError ?? keyError) && (
          <p role="alert" className="text-xs text-destructive">
            {urlError ?? keyError}
          </p>
        )}
        {load.kind === "error" && (
          <p role="alert" className="text-xs text-destructive">
            {load.message}
          </p>
        )}

        {load.kind === "loaded" && (
          <div className="flex flex-col gap-2">
            <Input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter models"
              aria-label="Filter models"
              autoComplete="off"
            />
            {visibleModels.length === 0 ? (
              <p className="text-xs text-text-muted">
                {load.models.length === 0 ? "The provider returned no models." : "No models match."}
              </p>
            ) : (
              <ul
                aria-label="Available models"
                className="max-h-48 overflow-y-auto rounded-control border border-border-default"
              >
                {visibleModels.map((model) => {
                  const isAdded = added.has(model.id);
                  return (
                    <li
                      key={model.id}
                      className="flex items-center justify-between gap-2 border-b border-border-default px-2 py-1 last:border-b-0"
                    >
                      <span className="min-w-0 truncate text-xs text-text-default">{model.id}</span>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={isAdded || connection === null}
                        aria-label={`${isAdded ? "Added" : "Add"} ${model.id}`}
                        onClick={() => handleAdd(model)}
                      >
                        {isAdded ? "Added" : "Add"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs text-text-muted">Model ID</span>
            <Input
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleManualAdd();
                }
              }}
              placeholder="gpt-4.1"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <Button size="sm" variant="outline" onClick={handleManualAdd} disabled={manualDisabled}>
            Add
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-medium text-text-primary">Your models</h4>
          {config.models.length === 0 ? (
            <p className="text-xs text-text-muted">No models yet.</p>
          ) : (
            <ul aria-label="Your models" className="rounded-control border border-border-default">
              {config.models.map((model) => (
                <li
                  key={model.id}
                  className="flex items-center justify-between gap-2 border-b border-border-default px-2 py-1 last:border-b-0"
                >
                  <span className="min-w-0 truncate text-xs text-text-default">{model.id}</span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Remove ${model.id}`}
                    onClick={() => removeByokModel(model.id)}
                  >
                    <XIcon size={12} weight="light" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SettingsGroup>
  );
}
