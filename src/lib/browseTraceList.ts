import type { StoredTraceSummary } from "@/lib/desktopBridge";

export type TraceListResult = { ok: true; traces: StoredTraceSummary[] } | { ok: false; message: string };

/** True when the desktop shell can list its saved traces. The web and an older shell cannot. */
export function canListLocalTraces(): boolean {
  return typeof window !== "undefined" && typeof window.penDesktop?.traces?.list === "function";
}

function toSummary(value: unknown): StoredTraceSummary | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.goal !== "string" || typeof v.startedAt !== "number") return null;
  return {
    id: v.id,
    goal: v.goal,
    startedAt: v.startedAt,
    status: typeof v.status === "string" ? v.status : "",
    ...(typeof v.qaOutcome === "string" ? { qaOutcome: v.qaOutcome } : {}),
  };
}

/** Lists the saved local traces, newest first as the shell sends them. Never rejects. */
export async function listLocalTraces(): Promise<TraceListResult> {
  const list = window.penDesktop?.traces?.list;
  if (typeof list !== "function") return { ok: false, message: "Local traces open only inside the Sideform desktop app." };
  try {
    const answer: unknown = await list();
    if (answer && typeof answer === "object" && "error" in answer && typeof answer.error === "string") {
      return { ok: false, message: answer.error };
    }
    if (!answer || typeof answer !== "object" || !("traces" in answer) || !Array.isArray(answer.traces)) {
      return { ok: false, message: "The desktop app returned an unexpected answer." };
    }
    const traces = answer.traces.map(toSummary).filter((t): t is StoredTraceSummary => t !== null);
    return { ok: true, traces };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
