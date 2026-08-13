import { Component, type ErrorInfo, type ReactNode } from "react";

import { recoverFromFatalError } from "@/pwa/updateSelfHeal";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// Mounted above AppRouter (see main.tsx) so it catches a crash from either
// route — the showcase at "/" or the editor at "/app". Its only job is to
// replace React's default "white screen + console error" with something a
// visitor can act on, and to trigger recoverFromFatalError(): the incident
// this exists for was a stale service-worker bundle whose render threw on a
// changed API shape, which meant the *previous* recovery mechanism (an
// effect inside the very tree that just failed to mount) never ran either.
// recoverFromFatalError() lives outside React for exactly that reason — see
// its module comment in @/pwa/updateSelfHeal.
//
// Deliberately dependency-free: this file is reachable from the showcase
// entry chunk, so it must not pull in any editor code or UI kit component —
// inline styles only, no Tailwind utility classes that might not even be
// generated for this route's bundle.
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Root render crashed", error, info.componentStack);
    recoverFromFatalError();
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          padding: "24px",
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
          color: "#1a1a1a",
        }}
      >
        <p style={{ margin: 0, fontSize: "14px" }}>Something went wrong.</p>
        {/* Mirrors the editor's default <Button> (ui/button.tsx: h-7, px-2,
            text-xs/relaxed, rounded-md, border-border, bg-primary) — spelled
            out as inline styles because this file must stay free of the UI kit
            and of Tailwind classes that this route's bundle may not generate. */}
        <button
          type="button"
          onClick={() => location.reload()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: "28px",
            padding: "0 8px",
            fontSize: "12px",
            lineHeight: "1.625",
            fontWeight: 500,
            fontFamily: "inherit",
            borderRadius: "6px",
            border: "1px solid oklch(0.922 0 0)",
            background: "#fff",
            color: "#1a1a1a",
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
