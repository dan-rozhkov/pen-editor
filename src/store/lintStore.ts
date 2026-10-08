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
  type LintSummary,
} from "@/lib/designLint";
import { LINT_BUDGET_MS, LINT_MAX_EMBEDS, LINT_MAX_NODES, resolveLintModes } from "@/lib/tools/lintDesign";

/** What the mode picker offers: the document's current context, every combination, or one Theme mode name. */
export type LintModeChoice = "current" | "all" | (string & {});

/** The panel lists up to this many findings (the tool's own ceiling). */
export const PANEL_LIMIT = 1000;

interface LintState {
  /** Findings on the active page, most severe first. Embeds on other pages are counted in `otherPages`. */
  findings: Finding[];
  summary: LintSummary | null;
  /** Findings in embeds on other pages: not listed, not fixable in v1. */
  otherPages: number;
  truncated: boolean;
  scanTruncated: boolean;
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
  run: () => void;
  select: (finding: Finding) => void;
  /** Fix one finding (a click on a value-changing fix is the explicit request). */
  fix: (id: string) => ApplyLintFixesResult;
  /** Fix every fixable finding (of one rule, when given). Value-changing snaps only when `rule` is `off-scale-value`. */
  fixAll: (rule?: LintRuleId) => ApplyLintFixesResult;
}

export function describeFixResult(result: ApplyLintFixesResult): string {
  const { applied, skipped } = result;
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const parts: string[] = [];
  parts.push(applied.length > 0 ? `Fixed ${count(applied.length, "finding")}.` : "Nothing was fixed.");
  const by = (reason: string) => skipped.filter((s) => s.reason === reason).length;
  if (by("stale")) parts.push(`${count(by("stale"), "finding")} changed since the last check; run it again.`);
  if (by("library")) parts.push(`${by("library")} belong to a linked library and stay as they are.`);
  if (by("changes-value")) parts.push(`${by("changes-value")} would change a value; fix those one by one.`);
  return parts.join(" ");
}

export const useLintStore = create<LintState>((set, get) => ({
  findings: [],
  summary: null,
  otherPages: 0,
  truncated: false,
  scanTruncated: false,
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

  run: () => {
    const input = buildLintInput();
    const { mode } = get();
    const modes = resolveLintModes(mode === "current" ? undefined : mode, input);
    if (!modes.ok) {
      set({ error: modes.error, mode: "current" });
      return;
    }
    const result = runDesignLint(input, {
      modes: modes.modes,
      limit: PANEL_LIMIT,
      maxNodes: LINT_MAX_NODES,
      maxEmbeds: LINT_MAX_EMBEDS,
      budgetMs: LINT_BUDGET_MS,
    });
    const onPage = result.findings.filter((f) => f.pageId === input.pageId);
    set({
      findings: onPage,
      summary: result.summary,
      otherPages: result.findings.length - onPage.length,
      truncated: result.truncated,
      scanTruncated: result.scanTruncated,
      pageId: input.pageId,
      hasRun: true,
      error: null,
    });
  },

  select: (finding) => {
    if (finding.pageId !== usePageStore.getState().activePageId) return;
    useSelectionStore.getState().setSelectedIds([finding.nodeId]);
  },

  fix: (id) => {
    const finding = get().findings.find((f) => f.id === id);
    const result = finding && isFixable(finding) ? applyLintFixes([finding], { allowValueChanges: true }) : { applied: [], skipped: [] };
    set({ notice: describeFixResult(result) });
    get().run();
    return result;
  },

  fixAll: (rule) => {
    const targets = get().findings.filter((f) => isFixable(f) && (!rule || f.rule === rule));
    const result = applyLintFixes(targets, { allowValueChanges: rule === "off-scale-value" });
    set({ notice: describeFixResult(result) });
    get().run();
    return result;
  },
}));
