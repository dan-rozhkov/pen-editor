import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import { RouteFallback } from "@/components/RouteFallback";
import { AuthBootstrap } from "@/components/auth/AuthBootstrap";
import { ShowcasePage } from "@/components/showcase/ShowcasePage";
import { RouteTracker } from "@/lib/analytics/RouteTracker";
import MobbinCallback from "@/routes/MobbinCallback";

// The editor pulls in PixiJS and the whole canvas/tool stack; the showcase at
// "/" must never pay that cost. Loading it via `lazy()` behind the "/app"
// route keeps it in its own chunk, separate from the showcase entry bundle.
const EditorApp = lazy(() => import("./App"));

// Same reasoning applies to the read-only shared-canvas viewer at "/c/:id" —
// it mounts the editor internally, so it must live in the editor's lazy
// chunk world too, never in the showcase entry bundle.
const SharedCanvasPage = lazy(() => import("./components/share/SharedCanvasPage"));

// The agent chat on its own at "/agent" (narrow desktop-shell panel). Lazy and
// separate from the editor chunk: it must never import App or the Pixi stack.
const AgentPage = lazy(() => import("@/routes/AgentPage"));

// The markdown document editor at "/doc" (desktop tab or plain browser). Lazy:
// Tiptap must stay out of the showcase and editor chunks.
const DocPage = lazy(() => import("@/routes/DocPage"));

// The workflow editor at "/workflow" (desktop tab or plain browser). Lazy, and
// it must never import App, Pixi, the scene stores or the chat.
const WorkflowPage = lazy(() => import("@/routes/WorkflowPage"));

// The settings page at "/settings" (desktop tab or plain browser). Lazy, and it
// must never import App or Pixi.
const SettingsPage = lazy(() => import("@/routes/SettingsPage"));

// The browse-run trace viewer at "/trace/:id" (desktop tab or plain browser),
// and "/trace" to open a trace file.
// Lazy, and it must never import App, Pixi or the chat.
const TracePage = lazy(() => import("@/routes/TracePage"));

// Accounts (Better Auth). Lazy for the same reason as the editor: the auth
// client must not weigh on the showcase entry bundle, and all three pages are
// only reachable on deployments where /api/auth-config reports accounts on.
const SignInPage = lazy(() => import("@/routes/SignInPage"));
const ConsentPage = lazy(() => import("@/routes/ConsentPage"));
const AccountPage = lazy(() => import("@/routes/AccountPage"));
// Browser half of the desktop shell's sign-in (/auth/desktop). No editor/Pixi imports.
const DesktopAuthPage = lazy(() => import("@/routes/DesktopAuthPage"));

// Public legal/support documents: static, no auth, no backend.
const PrivacyPage = lazy(() => import("@/routes/legal/PrivacyPage"));
const TermsPage = lazy(() => import("@/routes/legal/TermsPage"));
const SupportPage = lazy(() => import("@/routes/legal/SupportPage"));

export function AppRouter() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<ShowcasePage />} />
        {/* Popup-only OAuth callback for connecting Mobbin (mobbinAuth.ts).
            Not lazy — it has no editor/Pixi dependency, so there's no bundle
            cost to keep it in the showcase entry chunk. Must be included in
            the deployed SPA rewrite, same trap /app and /c/:id hit before. */}
        <Route path="/oauth/mobbin/callback" element={<MobbinCallback />} />
        <Route
          path="/app"
          element={
            <Suspense fallback={<RouteFallback />}>
              <EditorApp />
            </Suspense>
          }
        />
        <Route
          path="/agent"
          element={
            <Suspense fallback={<RouteFallback />}>
              <AgentPage />
            </Suspense>
          }
        />
        <Route
          path="/doc"
          element={
            <Suspense fallback={<RouteFallback />}>
              <DocPage />
            </Suspense>
          }
        />
        <Route
          path="/workflow"
          element={
            <Suspense fallback={<RouteFallback />}>
              <WorkflowPage />
            </Suspense>
          }
        />
        <Route
          path="/settings"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SettingsPage />
            </Suspense>
          }
        />
        <Route
          path="/trace"
          element={
            <Suspense fallback={<RouteFallback />}>
              <TracePage />
            </Suspense>
          }
        />
        <Route
          path="/trace/:id"
          element={
            <Suspense fallback={<RouteFallback />}>
              <TracePage />
            </Suspense>
          }
        />
        <Route
          path="/c/:shareId"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SharedCanvasPage />
            </Suspense>
          }
        />
        <Route
          path="/sign-in"
          element={
            <Suspense fallback={null}>
              <SignInPage />
            </Suspense>
          }
        />
        <Route
          path="/auth/desktop"
          element={
            <Suspense fallback={null}>
              <DesktopAuthPage />
            </Suspense>
          }
        />
        <Route
          path="/consent"
          element={
            <Suspense fallback={null}>
              <ConsentPage />
            </Suspense>
          }
        />
        <Route
          path="/account"
          element={
            <Suspense fallback={null}>
              <AccountPage />
            </Suspense>
          }
        />
        {(
          [
            ["/privacy", PrivacyPage],
            ["/terms", TermsPage],
            ["/support", SupportPage],
          ] as const
        ).map(([path, Page]) => (
          <Route
            key={path}
            path={path}
            element={
              <Suspense fallback={null}>
                <Page />
              </Suspense>
            }
          />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* $pageview on every route change, across both the showcase and the
          editor. No-op when analytics is disabled (no VITE_POSTHOG_KEY). */}
      <RouteTracker />
      {/* Mirrors the account session into authState once accounts are known
          to be enabled; renders nothing. */}
      <AuthBootstrap />
    </BrowserRouter>
  );
}
