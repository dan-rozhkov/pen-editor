import { Suspense, lazy } from "react";
import { useLocation } from "react-router";

import { getAppliedUITheme } from "@/lib/uiTheme";
import { autoApplyAlreadyTried, isEditorPath } from "@/pwa/updateSelfHeal";
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
// showcase there is none, so bring one along without importing the editor's
// theme store.
const ToasterBase = lazy(() =>
  import("@/components/ui/ToasterBase").then((m) => ({ default: m.ToasterBase })),
);

export function PwaUpdateGate() {
  const updateReady = usePwaStore((s) => s.updateReady);
  const suppressed = usePwaStore((s) => s.toastSuppressed);
  const autoApplyStalled = usePwaStore((s) => s.autoApplyStalled);
  // Route check shared with updateSelfHeal.ts (isEditorPath) rather than an
  // inline startsWith("/app") here — a second, drifting copy of "what counts
  // as the editor route" is exactly the kind of footgun that check's own
  // comment warns about.
  const isEditorRoute = isEditorPath(useLocation().pathname);
  const showcaseTheme = getAppliedUITheme();

  // Auto-applying the update itself no longer happens here — it runs from
  // registerServiceWorker's onNeedRefresh callback (see updateSelfHeal.ts),
  // outside React entirely, so it survives even a render that never
  // commits. This gate is left with exactly one job: the toast, which is
  // the fallback path. It always shows on the editor route (which never
  // auto-applies — it may hold an unsaved document). On the showcase it
  // shows once auto-apply has already been tried this session (pending or
  // silently failed either way), OR once applyUpdateNow's own stall timer
  // fires (autoApplyStalled) — that second condition exists because
  // autoApplyAlreadyTried is a session-flag read once at module init, so a
  // page that never reloads (activation hung, getUpdateSW() was undefined)
  // would otherwise never see this flip and the visitor would get neither
  // the silent update nor a toast for the rest of the session.
  const showToast =
    updateReady && !suppressed && (isEditorRoute || autoApplyAlreadyTried || autoApplyStalled);

  if (!showToast) return null;

  return (
    <Suspense fallback={null}>
      {!isEditorRoute && <ToasterBase theme={showcaseTheme} />}
      <PwaUpdateToast />
    </Suspense>
  );
}
