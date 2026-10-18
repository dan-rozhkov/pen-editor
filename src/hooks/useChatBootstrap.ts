import { useEffect } from "react";
import { loadModels } from "@/lib/chatModels";
import { reconcileModels } from "@/store/chatStore";

/**
 * Chat-specific mount work shared by every page that hosts the chat (App,
 * AgentPage): pull the authoritative model list from the backend, then drop
 * any saved selection it no longer offers. Falls back to the hardcoded list
 * on failure. `loadModels()` is a shared promise, so this is not a second request.
 */
export function useChatBootstrap(): void {
  useEffect(() => {
    void loadModels().then(reconcileModels);
  }, []);
}
