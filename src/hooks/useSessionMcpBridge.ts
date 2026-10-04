import { useEffect } from "react";

import { useAuthStore } from "@/lib/auth/authState";
import { startMcpBridgeForSession, stopMcpBridgeForSession } from "@/lib/mcpBridge";

// Cookie-mode MCP bridge: while a user is signed in and the editor is mounted
// (so only on /app, never the showcase), their tab accepts tool calls from
// agents authenticated as them. Signing out or leaving the editor disconnects.
// `enabled` is false for the read-only shared viewer.
export function useSessionMcpBridge(enabled: boolean): void {
  // Keyed on the account id, not just "signed in": switching accounts in one
  // tab must drop the old user's socket and reconnect as the new one.
  const userId = useAuthStore((s) => (s.status === "signed-in" ? s.userId : null));
  useEffect(() => {
    if (!enabled || !userId) return;
    startMcpBridgeForSession();
    return () => stopMcpBridgeForSession();
  }, [enabled, userId]);
}
