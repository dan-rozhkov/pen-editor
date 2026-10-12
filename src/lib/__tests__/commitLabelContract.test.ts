import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isIrreversibleLabel, isUnsafeCachedTarget } from "@/lib/tools/browser/actionCache";

/**
 * Pins the frontend step cache to the backend's commit-label prefilter
 * (pen-editor-backend/src/ai/browseCommitGuard.ts): every label the backend
 * guard treats as a commit must never be cached or replayed here, since a
 * replay skips /api/browse/step and with it the guard. Skipped when the
 * sibling backend checkout is absent.
 */
const BACKEND_GUARD = resolve(process.cwd(), "../pen-editor-backend/src/ai/browseCommitGuard.ts");
const hasBackend = existsSync(BACKEND_GUARD);

describe.skipIf(!hasBackend)("commit label contract with the backend", () => {
  it("never caches or replays any backend positive sample", async () => {
    // Variable path: keeps `tsc` from type-checking the backend's sources.
    const { COMMIT_LABEL_SAMPLES, commitKind } = (await import(
      /* @vite-ignore */ BACKEND_GUARD
    )) as {
      COMMIT_LABEL_SAMPLES: { positive: ReadonlyArray<readonly [string, string]> };
      commitKind: (label: string) => string | null;
    };
    expect(COMMIT_LABEL_SAMPLES.positive.length).toBeGreaterThan(0);
    const mismatches = COMMIT_LABEL_SAMPLES.positive.filter(
      ([label]) =>
        commitKind(label) === null ||
        !isIrreversibleLabel(label) ||
        !isUnsafeCachedTarget("CLICK", label, undefined, undefined)
    );
    expect(mismatches).toEqual([]);
  });
});
