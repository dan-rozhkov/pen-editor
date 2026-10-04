import { useEffect, useRef } from "react";

import { useUserSkillStore } from "@/store/userSkillStore";

import { useAuthStore } from "./authState";
import { claimAnonymousData } from "./claimAnon";
import { useSession } from "./session";

// Mounted once (lazily, only when /api/auth-config says accounts are on).
// Mirrors the session into authState, claims anonymous data on sign-in, and
// reloads per-user data (skills) whenever the identity changes — memory is
// server-side only, it just starts resolving to the account on the next turn.
export default function SessionSync() {
  const { data, isPending } = useSession();
  const userId = data?.user?.id ?? null;
  const setSession = useAuthStore((s) => s.setSession);
  const lastUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (isPending) return;
    setSession(userId);
    const identityChanged = lastUserId.current !== userId;
    lastUserId.current = userId;

    let cancelled = false;
    const refreshSkills = () => {
      if (cancelled) return;
      // "idle" = never opened: it will hydrate lazily under the right identity.
      if (useUserSkillStore.getState().status !== "idle") {
        void useUserSkillStore.getState().refresh();
      }
    };

    if (userId) {
      void claimAnonymousData().then((claimed) => {
        if (claimed) refreshSkills();
        else if (identityChanged) refreshSkills();
      });
    } else if (identityChanged) {
      refreshSkills();
    }
    return () => {
      cancelled = true;
    };
  }, [isPending, userId, setSession]);

  return null;
}
