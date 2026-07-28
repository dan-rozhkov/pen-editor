import { Suspense, lazy, useEffect, useState } from "react";
import { useLocation } from "react-router";

import { getUpdateSW } from "@/pwa/registerServiceWorker";
import { usePwaStore } from "@/store/pwaStore";

// The update prompt is mounted above the route split (AppRouter) because
// registerServiceWorker() runs on every entry: an update detected while the
// user sits on the showcase at "/" must have somewhere to render. It used to
// live inside the editor's App, which is exactly why "/" showed nothing.
//
// Everything it needs — sonner, the toast chrome, the icon button — is loaded
// lazily and only once an update actually exists. Mounting it eagerly instead
// pulled ~125 kB (sonner + the tooltip's floating-ui stack) into the showcase
// entry chunk, which the "/" route is deliberately kept clear of.
const PwaUpdateToast = lazy(() =>
  import("./PwaUpdateToast").then((m) => ({ default: m.PwaUpdateToast })),
);
// Sonner needs a mounted <Toaster /> portal to render into. The editor mounts
// its own (themed by uiThemeStore) and hosts the prompt there; on the
// showcase there is none, so bring one along — pinned light, since that shell
// is hardcoded white and must not import the editor's theme store.
const ToasterBase = lazy(() =>
  import("@/components/ui/ToasterBase").then((m) => ({ default: m.ToasterBase })),
);

// Marks "this tab already tried to activate a waiting worker". Read once at
// mount and cleared immediately: a successful auto-apply reloads into a build
// with nothing waiting, so the next load starts clean, while a failed one
// still sees the flag from before the reload and falls back to the prompt
// instead of reloading forever. sessionStorage (not local) keeps that scoped
// to the tab that did the reloading. (Cost of that simplicity: a second deploy
// landing in the very next load of the same tab prompts instead of applying
// itself. A prompt that works is a fine worst case; a reload loop is not.)
export const AUTO_APPLY_KEY = "pen.pwaAutoApplied";

export function PwaUpdateGate() {
  const updateReady = usePwaStore((s) => s.updateReady);
  const suppressed = usePwaStore((s) => s.toastSuppressed);
  const isEditorRoute = useLocation().pathname.startsWith("/app");

  // Snapshot at first render — before the effects below can write the flag and
  // before `updateReady` flips (registerServiceWorker resolves a tick or two
  // after mount), so this never reads our own write back.
  const [autoApplyTried] = useState(
    () => sessionStorage.getItem(AUTO_APPLY_KEY) !== null,
  );
  // Clearing lives in its own mount effect, declared before the apply effect so
  // it can't wipe the flag that one sets in the same commit.
  useEffect(() => sessionStorage.removeItem(AUTO_APPLY_KEY), []);

  // The showcase is a stateless gallery: a prompt there only means the visitor
  // keeps reading a stale bundle until they happen to click a toast — which is
  // exactly how a shipped style change sat unseen behind a refresh that could
  // never pick it up. Activate the waiting worker and reload right away.
  // The editor keeps the prompt: it may hold an unsaved document.
  const autoApply = updateReady && !suppressed && !isEditorRoute && !autoApplyTried;
  useEffect(() => {
    if (!autoApply) return;
    sessionStorage.setItem(AUTO_APPLY_KEY, "1");
    // Sends SKIP_WAITING; vite-plugin-pwa reloads once the new worker takes
    // control. Nothing to await — the page goes away.
    void getUpdateSW()?.(true);
  }, [autoApply]);

  if (!updateReady || suppressed || autoApply) return null;

  return (
    <Suspense fallback={null}>
      {!isEditorRoute && <ToasterBase theme="light" />}
      <PwaUpdateToast />
    </Suspense>
  );
}
