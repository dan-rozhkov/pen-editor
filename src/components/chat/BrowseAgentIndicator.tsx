import { useBrowseAgentPhaseStore } from "@/store/browseAgentPhaseStore";
import { ToolCallIndicator } from "./ToolCallIndicator";
import { redactBrowseSetupInput } from "@/lib/tools/browser/redactBrowseSetupInput";

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

/** Origin + pathname: no query, no hash. */
function pathPart(url: unknown): string | undefined {
  if (typeof url !== "string" || url === "") return undefined;
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return undefined;
  }
}

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
function describeSetup(input: unknown, succeeded: boolean): { line: string; mocked: boolean } | undefined {
  const root = asRecord(input);
  const setup = asRecord(root?.setup);
  if (!setup) return undefined;
  const parts: string[] = [];
  const path = pathPart(root?.url);
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
  return { line: `Setup: ${parts.join(" · ")}`, mocked: mocks > 0 };
}

/**
 * Chat chip for `browse_agent`: ToolCallIndicator plus the setup line, the
 * preparing phase, the mocked-data warning and the setup failure. Output it
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

  let statusLabel: string | undefined;
  if (running && phase === "setup" && setup) statusLabel = "Preparing page...";
  else if (setupFailed) statusLabel = "Setup failed";

  const detail =
    setup || setupFailed ? (
      <div className="space-y-0.5 pb-0.5 pl-5 text-[12px] leading-relaxed text-text-muted">
        {setup && <div className="break-words">{setup.line}</div>}
        {setupRan && setup?.mocked && (
          <div className="text-amber-500">⚠ API responses were mocked. Data on these pages is not real.</div>
        )}
        {setupFailed && (
          <>
            <div className="break-words text-amber-500">
              {`Stage: ${typeof out?.setupStage === "string" ? out.setupStage : "unknown"} — ${
                typeof out?.error === "string" ? out.error : "The page could not be prepared."
              }`}
            </div>
            <div className="text-amber-500">The agent did not run.</div>
          </>
        )}
      </div>
    ) : undefined;

  return (
    <ToolCallIndicator
      part={part}
      statusLabel={statusLabel}
      statusWarning={setupFailed}
      detail={detail}
      inputForDisplay={redactBrowseSetupInput(part.input)}
    />
  );
}
