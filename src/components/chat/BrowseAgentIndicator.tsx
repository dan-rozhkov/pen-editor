import { useBrowseAgentPhaseStore } from "@/store/browseAgentPhaseStore";
import { ToolCallIndicator } from "./ToolCallIndicator";
import { redactBrowseSetupInput } from "@/lib/tools/browser/redactBrowseSetupInput";
import { urlSummary } from "@/lib/tools/browser/browseToolHint";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPart = any;

const EXPECT_TEXT_MAX_CHARS = 40;

type Rec = Record<string, unknown>;

const asRecord = (v: unknown): Rec | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : undefined;

/** The tool output is a JSON string (or an already-parsed object). */
function parseOutput(output: unknown): Rec | undefined {
  if (typeof output !== "string") return asRecord(output);
  try {
    return asRecord(JSON.parse(output));
  } catch {
    return undefined;
  }
}

const countOf = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function expectPart(expectRaw: unknown): string | undefined {
  const e = asRecord(expectRaw);
  if (!e) return undefined;
  const text = typeof e.text === "string" && e.text !== "" ? e.text : undefined;
  const clipped = text && text.length > EXPECT_TEXT_MAX_CHARS ? `${text.slice(0, EXPECT_TEXT_MAX_CHARS)}…` : text;
  if (typeof e.selector === "string" && e.selector !== "") return `expect ${e.selector}`;
  if (clipped) return `expect "${clipped}"`;
  if (typeof e.url === "string" && e.url !== "") return `expect ${e.url}`;
  return undefined;
}

/**
 * The one-line summary of a `setup` input. Counts only for cookies and
 * storage: never a cookie or storage value, a mock body or a header.
 */
function describeSetup(input: unknown, succeeded: boolean): string | undefined {
  const root = asRecord(input);
  const setup = asRecord(root?.setup);
  if (!setup) return undefined;
  const parts: string[] = [];
  const path = urlSummary(root?.url);
  if (path) parts.push(path);
  const steps = countOf(setup.steps);
  if (steps > 0) parts.push(plural(steps, "step", "steps"));
  const mocks = countOf(setup.network);
  if (mocks > 0) parts.push(plural(mocks, "API mock", "API mocks"));
  if (setup.fresh === true) parts.push("fresh session");
  const storage = asRecord(setup.storage);
  const cookies = countOf(storage?.cookies);
  if (cookies > 0) parts.push(plural(cookies, "cookie", "cookies"));
  const origins = countOf(storage?.origins);
  if (origins > 0) parts.push(`storage for ${plural(origins, "origin", "origins")}`);
  const tabs = countOf(setup.tabs);
  if (tabs > 0) parts.push(plural(tabs, "tab", "tabs"));
  const expectText = expectPart(setup.expect);
  if (expectText) parts.push(succeeded ? "expect ✓" : expectText);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * Chat chip for `browse_agent`: ToolCallIndicator plus the Setup and Stage
 * panes (under the collapse), the preparing phase and the setup failure. Output it
 * cannot parse leaves the plain ToolCallIndicator.
 */
export function BrowseAgentIndicator({ part }: { part: AnyPart }) {
  const phase = useBrowseAgentPhaseStore((s) => s.phases[part.toolCallId as string]);
  const running = part.state !== "output-available" && part.state !== "output-error";
  const out = part.state === "output-available" ? parseOutput(part.output) : undefined;
  const status = typeof out?.status === "string" ? out.status : undefined;
  const setupFailed = status === "setup_failed";
  // The handler sets `setupApplied` only when the fixture really landed: an
  // aborted or timed-out run may never have got past "Preparing page...".
  const setupRan = out !== undefined && !setupFailed && out.setupApplied === true;
  const setup = describeSetup(part.input, setupRan);
  const resumedFrom = asRecord(part.input)?.resume;
  const hasResume = typeof resumedFrom === "string" && resumedFrom !== "";

  let statusLabel: string | undefined;
  if (running && phase === "setup" && (setup !== undefined || hasResume)) statusLabel = "Preparing page...";
  else if (setupFailed) statusLabel = "Setup failed";

  const extraPanes: Array<{ label: string; content: string }> = [];
  if (setup !== undefined) extraPanes.push({ label: "Setup", content: setup });
  if (setupFailed) {
    const stage = typeof out?.setupStage === "string" ? out.setupStage : "unknown";
    const error = typeof out?.error === "string" ? out.error : "The page could not be prepared.";
    extraPanes.push({ label: "Stage", content: `${stage} — ${error}\nThe agent did not run.` });
  }

  // Counts and ids only: the checkpoint fixture never reaches the chat.
  // Only when the checkpoint really landed (not on setup_failed or an aborted run).
  if (hasResume && setupRan) {
    extraPanes.push({ label: "Resume", content: `Resumed from ${resumedFrom}` });
  }
  const checkpoint = asRecord(out?.checkpoint);
  if (checkpoint && typeof checkpoint.id === "string") {
    const partial = checkpoint.complete === false;
    extraPanes.push({
      label: "Checkpoint",
      content: `Checkpoint ${checkpoint.id} saved${partial ? " (partial)" : ""}`,
    });
  }

  return (
    <ToolCallIndicator
      part={part}
      statusLabel={statusLabel}
      statusError={setupFailed}
      extraPanes={extraPanes}
      inputForDisplay={redactBrowseSetupInput(part.input)}
    />
  );
}
