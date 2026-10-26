import { browseTraceToPlaywrightSpec, type BrowseTrace } from "@sideform/browser-agent/agent/session";
import { FileCodeIcon } from "@/components/icons";
import { memo, useMemo } from "react";
import { IconButton } from "@/components/ui/IconButton";

/** "Download Playwright test": the run as a `.spec.ts` file. Hidden for a trace recorded without `repro`. */
export const PlaywrightButton = memo(function PlaywrightButton({ trace }: { trace: BrowseTrace }) {
  const spec = useMemo(() => browseTraceToPlaywrightSpec(trace), [trace]);
  if (!spec.ok) return null;
  const download = () => {
    const url = URL.createObjectURL(new Blob([spec.code], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = spec.fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const notes = [
    spec.gaps > 0 ? `${spec.gaps} ${spec.gaps === 1 ? "gap" : "gaps"}` : "",
    spec.failingChecks > 0 ? `${spec.failingChecks} failing ${spec.failingChecks === 1 ? "check" : "checks"}` : "",
  ].filter(Boolean);
  return (
    <IconButton
      tooltip={notes.length > 0 ? `Download Playwright test (${notes.join(", ")})` : "Download Playwright test"}
      aria-label="Download Playwright test"
      variant="ghost"
      size="icon"
      onClick={download}
    >
      <FileCodeIcon className="size-4" weight="light" />
    </IconButton>
  );
});
