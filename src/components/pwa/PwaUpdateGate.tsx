import { Suspense, lazy } from "react";
import { useLocation } from "react-router";

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

export function PwaUpdateGate() {
  const updateReady = usePwaStore((s) => s.updateReady);
  const suppressed = usePwaStore((s) => s.toastSuppressed);
  const isEditorRoute = useLocation().pathname.startsWith("/app");

  if (!updateReady || suppressed) return null;

  return (
    <Suspense fallback={null}>
      {!isEditorRoute && <ToasterBase theme="light" />}
      <PwaUpdateToast />
    </Suspense>
  );
}
