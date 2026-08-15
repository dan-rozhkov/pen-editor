import { create } from "zustand";
import {
  listUserSkills,
  listBuiltInSkills,
  createUserSkill,
  updateUserSkill,
  deleteUserSkill,
  generateUserSkill,
  type UserSkill,
  type BuiltInSkill,
  type CreateUserSkillInput,
  type UpdateUserSkillPatch,
  type UserSkillDraft,
} from "@/lib/userSkills";

export type UserSkillStoreStatus = "idle" | "loading" | "ready" | "error";

interface UserSkillStoreState {
  /** This user's own skills, as last fetched/mutated. */
  skills: UserSkill[];
  /** The curated (git-owned) catalog, read-only from here. */
  builtIn: BuiltInSkill[];
  /** Whether the backend has a user-skills store configured. False (with an
   * empty `skills` list, not a crash) means the feature is simply off on
   * this deployment — never treat it as an error state. */
  available: boolean;
  status: UserSkillStoreStatus;
  /** Most recent failure, if any. Cleared on the next successful call. Never
   * thrown — every mutator surfaces failures here instead. */
  error: string | null;
  /** Skill names with an in-flight `update()` write. Lets the panel disable
   * that row's controls so a fast double-click (e.g. the enable switch)
   * can't fire two overlapping writes whose responses may resolve out of
   * order and leave stale UI. */
  pendingUpdates: Record<string, boolean>;

  /** Hydrate `skills`/`builtIn` from the backend. Safe to call more than
   * once — a no-op once `status` has settled to "ready"; concurrent callers
   * before that share the same in-flight request. An "error" status is
   * *not* a short-circuit here — a single failed request must be
   * recoverable, so the next call (e.g. the panel reopening, or an explicit
   * `refresh()`) retries. */
  ensureHydrated: () => Promise<void>;
  /** Unconditionally reload both lists from the backend, regardless of
   * current status. */
  refresh: () => Promise<void>;
  /** Create a skill and add it to `skills` on success. Returns the created
   * skill, or null on failure (see `error`). */
  create: (input: CreateUserSkillInput) => Promise<UserSkill | null>;
  /** Patch a skill (including rename) and replace it in `skills` on success.
   * Returns the updated skill, or null on failure. */
  update: (name: string, patch: UpdateUserSkillPatch) => Promise<UserSkill | null>;
  /** Delete a skill and remove it from `skills` on success. Returns whether
   * the delete succeeded. */
  remove: (name: string) => Promise<boolean>;
  /** Ask the agent to draft a skill from a workflow description. Persists
   * nothing — the caller reviews the draft and calls `create()` itself.
   * Returns the draft, or null on failure. */
  generate: (prompt: string) => Promise<UserSkillDraft | null>;
}

/**
 * User-authored "custom skills" (Figma-style), scoped to the anonymous
 * userId (src/lib/userId.ts) and backed by pen-editor-backend's
 * `/api/user-skills` routes. Modeled directly on `src/store/pluginStore.ts`:
 * lazy idempotent `ensureHydrated`, an in-flight promise shared by concurrent
 * callers, write-through mutators that hit the API first and only touch
 * local state on success, and every failure surfaced via `error` instead of
 * a thrown exception — `src/lib/userSkills.ts`'s client already never
 * throws, so nothing here needs a try/catch to keep that guarantee.
 */
export const useUserSkillStore = create<UserSkillStoreState>((set, get) => {
  // In-flight hydration promise, shared by concurrent callers — same
  // rationale as pluginStore's initPromise: a mutation that races
  // ensureHydrated() (e.g. opening the panel and immediately creating a
  // skill) should wait on the same read rather than starting a second one.
  let hydratePromise: Promise<void> | null = null;

  const load = async (): Promise<void> => {
    set({ status: "loading", error: null });

    const [listResult, builtInResult] = await Promise.all([listUserSkills(), listBuiltInSkills()]);

    // A failed built-in fetch must not blank the user's own skills — per the
    // contract, treat it as "empty + error", surfaced but not fatal to the
    // rest of the panel.
    const builtIn = builtInResult.ok ? builtInResult.data : [];

    if (!listResult.ok) {
      set({
        status: "error",
        error: listResult.error,
        skills: [],
        builtIn,
        available: false,
      });
      return;
    }

    set({
      status: "ready",
      error: builtInResult.ok ? null : builtInResult.error,
      skills: listResult.data.skills,
      builtIn,
      available: listResult.data.available,
    });
  };

  const ensureHydrated = (): Promise<void> => {
    const { status } = get();
    if (status === "ready") return Promise.resolve();
    if (!hydratePromise) {
      hydratePromise = load().finally(() => {
        hydratePromise = null;
      });
    }
    return hydratePromise;
  };

  return {
    skills: [],
    builtIn: [],
    available: true,
    status: "idle",
    error: null,
    pendingUpdates: {},

    ensureHydrated,
    refresh: load,

    create: async (input) => {
      const result = await createUserSkill(input);
      if (!result.ok) {
        set({ error: result.error });
        return null;
      }
      set((s) => ({
        skills: [result.data, ...s.skills.filter((sk) => sk.name !== result.data.name)],
        error: null,
      }));
      return result.data;
    },

    update: async (name, patch) => {
      set((s) => ({ pendingUpdates: { ...s.pendingUpdates, [name]: true } }));
      const result = await updateUserSkill(name, patch);
      const clearPending = (s: UserSkillStoreState): Pick<UserSkillStoreState, "pendingUpdates"> => {
        const pendingUpdates = { ...s.pendingUpdates };
        delete pendingUpdates[name];
        return { pendingUpdates };
      };

      if (!result.ok) {
        set((s) => ({ ...clearPending(s), error: result.error }));
        return null;
      }
      set((s) => ({
        ...clearPending(s),
        skills: s.skills.map((sk) => (sk.name === name ? result.data : sk)),
        error: null,
      }));
      return result.data;
    },

    remove: async (name) => {
      const result = await deleteUserSkill(name);
      if (!result.ok) {
        set({ error: result.error });
        return false;
      }
      set((s) => ({ skills: s.skills.filter((sk) => sk.name !== name), error: null }));
      return true;
    },

    generate: async (prompt) => {
      const result = await generateUserSkill(prompt);
      if (!result.ok) {
        set({ error: result.error });
        return null;
      }
      set({ error: null });
      return result.data;
    },
  };
});
