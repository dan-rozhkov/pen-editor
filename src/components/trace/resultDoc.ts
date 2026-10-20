import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import { clip, describeCheck, describeOutcome, formatDuration, goalFirstLine, traceDuration } from "./traceModel";

// The run result as a Markdown document: pure builders, no DOM, no storage.

const TITLE_MAX = 60;

/** The text of the result: the answer, else (QA runs) the verdict reason. Empty when there is none. */
export function resultText(trace: BrowseTrace): string {
  return (trace.answer?.trim() || trace.qa?.reason?.trim() || "").trim();
}

/** The goal's first line, cut to 60 characters. */
export function goalHeadline(goal: string): string {
  return clip(goalFirstLine(goal), TITLE_MAX);
}

/** True when the result can be opened as a document: always on the web, on desktop only with `docs.open`. */
export function canOpenResult(): boolean {
  const desktop = typeof window !== "undefined" ? window.penDesktop : undefined;
  return !desktop || !!desktop.docs?.open;
}

export function resultDocTitle(trace: BrowseTrace): string {
  return `Result · ${goalHeadline(trace.goal)}`;
}

/** A meta line, the answer as it is (already Markdown), then a QA section for QA runs. The doc editor shows the title itself, so there is no H1. */
export function buildResultMarkdown(trace: BrowseTrace): string {
  const outcome = describeOutcome(trace);
  const date = new Date(trace.startedAt).toISOString().slice(0, 10);
  const parts = [`${outcome.label} · ${date} · ${formatDuration(traceDuration(trace))}`];
  if (trace.answer?.trim()) parts.push(trace.answer.trim());
  const qa = trace.qa;
  if (qa) {
    const lines = ["## QA", `**${outcome.label}**${qa.reason?.trim() ? `: ${qa.reason.trim()}` : ""}`];
    const failed = (qa.checks ?? []).filter((c) => !c.passed);
    if (failed.length > 0) {
      lines.push("", "Failed checks:", "", ...failed.map((c) => `- ${describeCheck(c.check)}${c.error || c.actual ? ` (${c.error ?? c.actual})` : ""}`));
    }
    parts.push(lines.join("\n"));
  }
  return `${parts.join("\n\n")}\n`;
}
