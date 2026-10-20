import type { DesktopAuthApi } from "@/lib/desktopBridge";

/** The desktop shell's sign-in bridge (editor tab or agent panel), or null on the web / an older shell. */
export function desktopAuth(): DesktopAuthApi | null {
  const api = window.penDesktop?.auth ?? window.penAgentPanel?.auth;
  return api && typeof api.signIn === "function" && typeof api.onToken === "function" ? api : null;
}
