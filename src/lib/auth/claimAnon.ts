import { apiFetch } from "@/lib/apiBase";
import { clearUserId, peekUserId } from "@/lib/userId";

// After the first sign-in in a browser that still holds an anonymous id,
// hand its data (memory, skills, shares, likes) to the account. The anon id is
// forgotten on 200 AND 409 (already claimed — by this or another account; the
// id is spent either way). Any other outcome (network, 5xx, 401) keeps it so a
// later load can retry. Resolves true when the id was cleared.
export async function claimAnonymousData(): Promise<boolean> {
  const anonId = peekUserId();
  if (!anonId) return false;
  try {
    const res = await apiFetch("/api/account/claim-anon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anonId }),
    });
    if (res.status === 200 || res.status === 409) {
      clearUserId();
      return true;
    }
  } catch {
    // offline: try again on the next load
  }
  return false;
}
