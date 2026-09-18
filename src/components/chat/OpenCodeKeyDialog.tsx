import { useEffect, useRef, useState } from "react";
import { resolveApiUrl } from "@/lib/apiBase";
import {
  clearOpenCodeKey,
  getOpenCodeKey,
  setOpenCodeKey,
} from "@/lib/opencodeKey";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface OpenCodeKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ValidateResult =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "valid"; modelCount: number }
  | { kind: "invalid_key" }
  | { kind: "upstream_error" };

// Backend wire shape (pen-editor-backend POST /api/opencode/validate).
interface ValidateResponse {
  ok: boolean;
  reason?: "invalid_key" | "upstream_error";
  models?: string[];
}

const VALIDATE_TIMEOUT_MS = 15_000;

/**
 * "Connect OpenCode" / "OpenCode key" dialog — lets the user paste a key
 * from their OpenCode Go/Zen console, check it against the backend's relay
 * route (the browser can't reach opencode.ai itself, see
 * src/routes/opencode.ts on the backend), save it, or remove it.
 *
 * The key never leaves this component except as the `X-OpenCode-Key` header
 * on the validate call and, later, on an actual chat turn — see
 * useDesignChat.ts's prepareSendMessagesRequest. Saving/removing goes
 * through src/lib/opencodeKey.ts exclusively (its own header explains why:
 * one point of truth for a credential, the lesson from shareCanvas.ts).
 */
export function OpenCodeKeyDialog({ open, onOpenChange }: OpenCodeKeyDialogProps) {
  const [inputValue, setInputValue] = useState("");
  const [result, setResult] = useState<ValidateResult>({ kind: "idle" });
  // Drives the Check button's disabled/"Checking…" state. Deliberately
  // separate from `result` (which onChange resets to "idle" on every
  // keystroke, including mid-flight edits) — the button must stay blocked
  // for as long as a request is actually in flight, not just until the
  // user next types.
  const [isVerifying, setIsVerifying] = useState(false);

  // Defect 3 (code review): handleCheck is async, so its response can land
  // after the world it was asked about has moved on — the input was edited
  // to an unchecked key, or the dialog was closed (and possibly reopened,
  // which resets state during render — see the `wasOpen` block below). Two
  // refs, read/written synchronously (unlike state, no batching delay)
  // rather than closed-over `inputValue`/`open`, which would still read
  // stale values from the render that started the request:
  //   - `checkedKeyRef` holds the key the LATEST handleCheck call started
  //     for. A response is applied only if it matches both this (no newer
  //     check superseded it) and the live input (no untracked edit happened
  //     without going through a new check).
  //   - `openRef` mirrors the `open` prop; a response arriving while closed
  //     must never write state that a reopen is about to reset.
  // `isCheckingRef` blocks a second concurrent request from firing at all —
  // stronger than disabling the button on `result.kind === "checking"`,
  // which is a state read and could theoretically still race a second
  // synchronous call before that state commits.
  //
  // `openRef`/`inputValueRef` are synced via `useEffect`, not written
  // directly in the render body — react-hooks/refs (the lint rule backing
  // the React Compiler's rules) forbids mutating `ref.current` during
  // render. An effect still lands the new value before any fetch this
  // component starts could possibly resolve (real network latency dwarfs
  // one commit-and-effect cycle), so there is no race reintroduced by the
  // one-tick delay.
  const checkedKeyRef = useRef<string | null>(null);
  const isCheckingRef = useRef(false);
  const openRef = useRef(open);
  const inputValueRef = useRef(inputValue);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    inputValueRef.current = inputValue;
  }, [inputValue]);

  // Whether a key is currently saved — read directly from storage on every
  // render rather than cached in its own state: a Save/Remove click already
  // triggers a re-render (it sets `inputValue`/`result`), so this stays
  // fresh with no extra state to keep in sync, and localStorage reads are
  // cheap. See opencodeKey.ts's own comment on why it re-reads rather than
  // trusting a stale cache.
  const hasStoredKey = getOpenCodeKey() !== null;

  // Reset the form's local (non-storage) state the moment the dialog
  // transitions to open — a key entered on a previous open (then abandoned
  // without saving) must not linger in the input. This adjusts state during
  // render (React's documented alternative to an effect for "reset state
  // when a prop changes": https://react.dev/learn/you-might-not-need-an-
  // effect#adjusting-some-state-when-a-prop-changes) rather than in a
  // useEffect, which would call setState synchronously in the effect body
  // and cause the extra render-then-effect-then-render cascade
  // react-hooks/set-state-in-effect exists to catch.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setInputValue("");
      setResult({ kind: "idle" });
      // No `checkedKeyRef.current = null` here (and it can't be written here
      // anyway — this runs during render): resetting `inputValue` to "" is
      // enough on its own. Once the `inputValueRef` effect above syncs to
      // "", handleCheck's stale-response guard (`inputValueRef.current.trim()
      // !== key`) already discards any response for the old key, since "" never
      // equals a non-empty checked key.
    }
  }

  const handleCheck = async () => {
    const key = inputValue.trim();
    if (!key || isCheckingRef.current) return;
    isCheckingRef.current = true;
    checkedKeyRef.current = key;
    setIsVerifying(true);
    setResult({ kind: "checking" });
    try {
      const res = await fetch(resolveApiUrl("/api/opencode/validate"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenCode-Key": key,
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
      });
      const data = (await res.json().catch(() => undefined)) as
        | ValidateResponse
        | undefined;
      // Stale response guard: only apply it if this is still the key the
      // (live) input holds, the dialog is still open, and no newer check
      // has since started for a different key. An edit mid-flight, a close,
      // or a fresh check for another key must all leave this response
      // discarded rather than painting a verdict onto the wrong key.
      if (
        checkedKeyRef.current !== key ||
        inputValueRef.current.trim() !== key ||
        !openRef.current
      ) {
        return;
      }
      if (data?.ok) {
        setResult({ kind: "valid", modelCount: data.models?.length ?? 0 });
      } else if (data?.reason === "invalid_key") {
        setResult({ kind: "invalid_key" });
      } else {
        setResult({ kind: "upstream_error" });
      }
    } catch {
      if (
        checkedKeyRef.current === key &&
        inputValueRef.current.trim() === key &&
        openRef.current
      ) {
        setResult({ kind: "upstream_error" });
      }
    } finally {
      isCheckingRef.current = false;
      setIsVerifying(false);
    }
  };

  const handleSave = () => {
    const key = inputValue.trim();
    if (!key) return;
    setOpenCodeKey(key);
    setInputValue("");
    setResult({ kind: "idle" });
    checkedKeyRef.current = null;
  };

  const handleRemove = () => {
    clearOpenCodeKey();
    setInputValue("");
    setResult({ kind: "idle" });
    checkedKeyRef.current = null;
  };

  const isChecking = isVerifying;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby="opencode-key-dialog-description">
        <DialogHeader>
          <DialogTitle>OpenCode key</DialogTitle>
          <DialogDescription id="opencode-key-dialog-description">
            Paste your OpenCode Go or Zen key to chat on OpenCode-billed
            models. It's stored only in this browser and sent only on turns
            that use an OpenCode model.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {hasStoredKey && (
            <p className="text-xs text-text-muted">A key is currently saved.</p>
          )}
          <input
            type="password"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setResult({ kind: "idle" });
            }}
            placeholder={hasStoredKey ? "Enter a new key to replace it" : "sk-…"}
            autoComplete="off"
            spellCheck={false}
            className="h-7 w-full min-w-0 rounded-md border border-border-default bg-secondary px-2 text-xs text-text-default outline-none"
            aria-label="OpenCode key"
          />

          {result.kind === "valid" && (
            <p className="text-xs text-text-default">
              Key accepted — {result.modelCount} model
              {result.modelCount === 1 ? "" : "s"} available.
            </p>
          )}
          {result.kind === "invalid_key" && (
            <p className="text-xs text-destructive">
              That key wasn't accepted. Double-check it and try again.
            </p>
          )}
          {result.kind === "upstream_error" && (
            <p className="text-xs text-destructive">
              Couldn't reach OpenCode to check this key. Try again in a
              moment.
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleCheck()}
              disabled={!inputValue.trim() || isChecking}
            >
              {isChecking ? "Checking…" : "Check"}
            </Button>
            <div className="flex items-center gap-2">
              {hasStoredKey && (
                <Button size="sm" variant="destructive" onClick={handleRemove}>
                  Remove key
                </Button>
              )}
              <Button size="sm" onClick={handleSave} disabled={!inputValue.trim()}>
                Save
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}
