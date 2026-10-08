import { create } from "zustand";
import { usePageStore } from "@/store/pageStore";
import { useSelectionStore } from "@/store/selectionStore";
import {
  applyLintFixes,
  buildLintInput,
  isFixable,
  runDesignLint,
  type ApplyLintFixesResult,
  type Finding,
  type LintRuleId,
} from "@/lib/designLint";
import { plural } from "@/lib/designLint/plural";
import { isLibraryComponent } from "@/lib/designSystem/ownership";
import type { EmbedNode } from "@/types/scene";
import { LINT_BUDGET_MS, LINT_MAX_EMBEDS, LINT_MAX_NODES, resolveLintModes } from "@/lib/tools/lintDesign";

/** What the mode picker offers: the document's current context, every combination, or one Theme mode name. */
export type LintModeChoice = "current" | "all" | (string & {});

/** The panel lists up to this many findings (the tool's own ceiling). */
export const PANEL_LIMIT = 1000;

/** Counts for the active page only. */
export interface PanelSummary {
  errors: number;
  warnings: number;
  info: number;
  nodes: number;
  embeds: number;
}

/** The auto-run budget: small enough that an idle re-check never freezes the editor. */
export const AUTO_BUDGET_MS = 300;

let applyingFix = false;
/** True while a Fix writes to the scene, so the idle re-run does not treat that write as an edit. */
export const isApplyingLintFix = (): boolean => applyingFix;

interface LintState {
  /** Findings on the active page, most severe first. Embeds on other pages are counted in `otherPages`. */
  findings: Finding[];
  summary: PanelSummary | null;
  /** Ids of findings the panel can fix (has fix data and is not library-owned). */
  fixable: Record<string, boolean>;
  /** Ids of findings on a library-owned component. */
  library: Record<string, boolean>;
  /** Findings in embeds on other pages: not listed, not fixable in v1. */
  otherPages: number;
  truncated: boolean;
  scanTruncated: boolean;
  /** The last run was an idle re-check that stopped early; "Check again" runs it in full. */
  partial: boolean;
  /** The page the last run described. */
  pageId: string | null;
  mode: LintModeChoice;
  /** Empty means every rule. */
  ruleFilter: LintRuleId | null;
  hasRun: boolean;
  /** Plain-language result of the last fix, for the status line. */
  notice: string | null;
  error: string | null;

  setMode: (mode: LintModeChoice) => void;
  setRuleFilter: (rule: LintRuleId | null) => void;
  /** `auto` runs use the small budget and mark the result partial instead of blocking. */
  run: (opts?: { auto?: boolean }) => void;
  select: (finding: Finding) => void;
  /** Fix one finding (a click on a value-changing fix is the explicit request). */
  fix: (id: string) => ApplyLintFixesResult;
  /** Fix every fixable finding (of one rule, when given). Value-changing snaps only when `rule` is `off-scale-value`. */
  fixAll: (rule?: LintRuleId) => ApplyLintFixesResult;
}

export function describeFixResult(result: ApplyLintFixesResult): string {
  const { applied, skipped } = result;
  const count = plural;
  const parts: string[] = [];
  parts.push(applied.length > 0 ? `Fixed ${count(applied.length, "finding")}.` : "Nothing was fixed.");
  const by = (reason: string) => skipped.filter((s) => s.reason === reason).length;
  if (by("stale")) parts.push(`${count(by("stale"), "finding")} changed since the last check; run it again.`);
  if (by("other-page")) parts.push("The page changed; run the check again.");
  if (by("library")) parts.push(`${by("library")} belong to a linked library and stay as they are.`);
  if (by("changes-value")) parts.push(`${by("changes-value")} would change a value; fix those one by one.`);
  return parts.join(" ");
}

export const useLintStore = create<LintState>((set, get) => ({
  findings: [],
  summary: null,
  fixable: {},
  library: {},
  otherPages: 0,
  truncated: false,
  scanTruncated: false,
  partial: false,
  pageId: null,
  mode: "current",
  ruleFilter: null,
  hasRun: false,
  notice: null,
  error: null,

  setMode: (mode) => {
    set({ mode });
    get().run();
  },
  setRuleFilter: (ruleFilter) => set({ ruleFilter }),

  run: (opts) => {
    const input = buildLintInput();
    const { mode } = get();
    const modes = resolveLintModes(mode === "current" ? undefined : mode, input);
    if (!modes.ok) {
      // Never leave findings of the old mode on screen: reset and check again.
      set({ error: modes.error, mode: "current" });
      get().run(opts);
      set({ error: modes.error });
      return;
    }
    const result = runDesignLint(input, {
      modes: modes.modes,
      limit: PANEL_LIMIT,
      maxNodes: LINT_MAX_NODES,
      maxEmbeds: LINT_MAX_EMBEDS,
      budgetMs: opts?.auto ? AUTO_BUDGET_MS : LINT_BUDGET_MS,
    });
    const onPage = result.findings.filter((f) => f.pageId === input.pageId);
    const summary: PanelSummary = {
      errors: onPage.filter((f) => f.severity === "error").length,
      warnings: onPage.filter((f) => f.severity === "warning").length,
      info: onPage.filter((f) => f.severity === "info").length,
      nodes: result.summary.scanned.nodes,
      embeds: input.embeds.filter((e) => e.pageId === input.pageId && input.nodesById[e.nodeId]?.visible !== false).length,
    };
    const fixable: Record<string, boolean> = {};
    const library: Record<string, boolean> = {};
    for (const f of onPage) {
      const node = input.nodesById[f.nodeId];
      const owned = node?.type === "embed" && isLibraryComponent((node as unknown as EmbedNode).component);
      if (owned) library[f.id] = true;
      if (isFixable(f) && !owned) fixable[f.id] = true;
    }
    set({
      findings: onPage,
      summary,
      fixable,
      library,
      otherPages: result.findings.length - onPage.length,
      truncated: result.truncated,
      scanTruncated: result.scanTruncated,
      partial: !!opts?.auto && result.scanTruncated,
      pageId: input.pageId,
      hasRun: true,
      error: null,
    });
  },

  select: (finding) => {
    const state = get();
    if (finding.pageId !== usePageStore.getState().activePageId || state.pageId !== finding.pageId) {
      state.run();
      return;
    }
    useSelectionStore.getState().setSelectedIds([finding.nodeId]);
  },

  fix: (id) => {
    const state = get();
    const finding = state.findings.find((f) => f.id === id);
    if (!finding || !state.fixable[id]) return { applied: [], skipped: [] };
    return apply(set, get, [finding], true);
  },

  fixAll: (rule) => {
    const state = get();
    const targets = state.findings.filter((f) => state.fixable[f.id] && (!rule || f.rule === rule));
    return apply(set, get, targets, rule === "off-scale-value");
  },
}));

function apply(
  set: (partial: Partial<LintState>) => void,
  get: () => LintState,
  targets: Finding[],
  allowValueChanges: boolean,
): ApplyLintFixesResult {
  applyingFix = true;
  let result: ApplyLintFixesResult;
  try {
    // A fix whose finding belongs to another page than the active one comes back as "other-page".
    result = applyLintFixes(targets, { allowValueChanges });
  } finally {
    applyingFix = false;
  }
  set({ notice: describeFixResult(result) });
  get().run();
  return result;
}
