import { THEME_COLLECTION_ID, type ModeContext } from "@/types/variable";
import { completeModeContext } from "@/lib/variables";
import {
  DEFAULT_LIMIT,
  LINT_RULE_IDS,
  SEVERITY_ORDER,
  buildLintInput,
  runDesignLint,
  type Finding,
  type LintFix,
  type LintInput,
  type LintResult,
  type LintRuleId,
  type Severity,
} from "@/lib/designLint";
import type { ToolHandler } from "../toolRegistry";
import { findCollection, findMode, formatVariableRef } from "./variableToolUtils";

export const LINT_MAX_NODES = 20_000;
export const LINT_MAX_EMBEDS = 50;
export const LINT_BUDGET_MS = 8_000;
const MAX_LIMIT = 1000;

/** A finding as the agent sees it: the machine-applicable fix is replaced by a sentence. */
export interface AgentFinding extends Omit<Finding, "fix"> {
  fixHint?: string;
}

/** What to do about a finding, using tools the agent already has. */
function fixHintFor(fix: LintFix, input: LintInput): string {
  const ref = (variableId: string) => {
    const v = input.variables.find((x) => x.id === variableId);
    return v ? formatVariableRef(input.variables, input.collections, v) : `$id:${variableId}`;
  };
  switch (fix.kind) {
    case "bind-color":
      return `Bind the ${fix.slot} to ${ref(fix.variableId)} (batch_design or replace_all_matching_properties).`;
    case "bind-number":
      return `Bind ${fix.key} to ${ref(fix.variableId)}${fix.changesValue ? "; this changes the value" : ""} (batch_design or replace_all_matching_properties).`;
    case "embed-replace":
      return `In ${fix.property}, replace ${fix.from} with ${fix.to} (edit_embed_html).`;
    case "rebind":
      return `Rebind ${fix.target} from ${ref(fix.fromVariableId)} to ${ref(fix.toVariableId)} (batch_design or replace_all_matching_properties).`;
    case "reconcile-component":
      return `Update the instance of component \`${fix.key}\` from its master (edit_embed_html or define_component).`;
  }
}

export function toAgentFinding({ fix, ...rest }: Finding, input: LintInput): AgentFinding {
  return fix ? { ...rest, fixHint: fixHintFor(fix, input) } : rest;
}

type ModeResolution = { ok: true; modes: ModeContext[] | undefined } | { ok: false; error: string };

/**
 * `mode` argument to mode contexts. Omitted: the document's current context
 * only. "all": undefined, so the runner enumerates every combination (cap 8).
 * A string: a Theme mode name. An object: collection name to mode name.
 */
export function resolveLintModes(mode: unknown, input: LintInput): ModeResolution {
  const collections = input.collections;
  const base = completeModeContext(collections, input.baseModes);
  if (mode === undefined || mode === null || mode === "") return { ok: true, modes: [base] };
  if (mode === "all") return { ok: true, modes: undefined };
  if (typeof mode === "string") {
    const theme = collections.find((c) => c.id === THEME_COLLECTION_ID);
    const found = theme ? findMode(theme, mode) : undefined;
    if (!theme || !found) return { ok: false, error: `No Theme mode matches "${mode}".` };
    return { ok: true, modes: [{ ...base, [theme.id]: found.id }] };
  }
  if (typeof mode === "object" && !Array.isArray(mode)) {
    const picked: ModeContext = { ...base };
    for (const [collectionRef, modeRef] of Object.entries(mode as Record<string, unknown>)) {
      const collection = findCollection(collections, collectionRef);
      const found = collection && typeof modeRef === "string" ? findMode(collection, modeRef) : undefined;
      if (!collection || !found) return { ok: false, error: `No mode matches ${collectionRef}: ${String(modeRef)}.` };
      picked[collection.id] = found.id;
    }
    return { ok: true, modes: [picked] };
  }
  return { ok: false, error: "mode must be \"all\", a mode name, or an object that maps collection names to mode names." };
}

function intArg(raw: unknown, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) return fallback;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function hintFor(result: LintResult): string {
  const total = result.summary.errors + result.summary.warnings + result.summary.info;
  const parts: string[] = [];
  if (total > result.findings.length) {
    parts.push(
      `Showing ${result.findings.length} of ${total} findings, most severe first. Raise limit, or narrow the check with nodeIds, rules or severity.`,
    );
  }
  if (result.scanTruncated) {
    parts.push(
      `The scan stopped at a limit (${LINT_MAX_NODES} nodes, ${LINT_MAX_EMBEDS} embeds or ${LINT_BUDGET_MS / 1000} s), so some of the design was not checked. Pass nodeIds to check a smaller part.`,
    );
  }
  if (result.summary.scanned.embedsPartial) {
    parts.push(`${result.summary.scanned.embedsPartial} embed(s) were only partly checked because they are large.`);
  }
  if (total === 0 && !result.scanTruncated) parts.push("No findings.");
  return parts.join(" ");
}

const fail = (error: string) => JSON.stringify({ error });

export const lintDesign: ToolHandler = async (args) => {
  const input = buildLintInput();
  const modes = resolveLintModes(args.mode, input);
  if (!modes.ok) return fail(modes.error);

  let nodeIds: string[] | undefined;
  if (args.nodeIds !== undefined && args.nodeIds !== null) {
    if (!Array.isArray(args.nodeIds) || args.nodeIds.length === 0 || args.nodeIds.some((x) => typeof x !== "string")) {
      return fail("nodeIds must be a non-empty array of node ids. Omit it to check the whole page.");
    }
    nodeIds = args.nodeIds as string[];
    const unknown = nodeIds.filter((id) => !input.nodesById[id]);
    if (unknown.length > 0) return fail(`Unknown node ids on the active page: ${unknown.join(", ")}.`);
  }

  let rules: LintRuleId[] | undefined;
  if (args.rules !== undefined && args.rules !== null) {
    if (!Array.isArray(args.rules)) return fail(`rules must be an array. Valid rules: ${LINT_RULE_IDS.join(", ")}.`);
    const bad = args.rules.filter((r) => !(LINT_RULE_IDS as readonly unknown[]).includes(r));
    if (bad.length > 0) return fail(`Unknown rules: ${bad.map(String).join(", ")}. Valid rules: ${LINT_RULE_IDS.join(", ")}.`);
    rules = args.rules as LintRuleId[];
  }

  let severity: Severity | undefined;
  if (args.severity !== undefined && args.severity !== null && args.severity !== "") {
    if (!(SEVERITY_ORDER as readonly unknown[]).includes(args.severity)) {
      return fail(`Unknown severity: ${String(args.severity)}. Valid values: ${SEVERITY_ORDER.join(", ")}.`);
    }
    severity = args.severity as Severity;
  }
  const limit = intArg(args.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);

  const result = runDesignLint(input, {
    nodeIds,
    rules,
    severity,
    limit,
    modes: modes.modes,
    maxNodes: LINT_MAX_NODES,
    maxEmbeds: LINT_MAX_EMBEDS,
    budgetMs: LINT_BUDGET_MS,
  });

  return JSON.stringify({
    summary: result.summary,
    findings: result.findings.map((f) => toAgentFinding(f, input)),
    truncated: result.truncated,
    scanTruncated: result.scanTruncated,
    hint: hintFor(result),
  });
};
