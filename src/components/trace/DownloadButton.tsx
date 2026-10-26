import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import { DownloadSimpleIcon } from "@/components/icons";
import { memo, useState } from "react";
import { toast } from "sonner";
import { IconButton } from "@/components/ui/IconButton";
import { exportBrowseTrace, traceFileName } from "@/lib/browseTraceFile";

/** "Download trace": the run as one portable JSON file, frames inlined. */
export const DownloadButton = memo(function DownloadButton({ trace, cloudTraceId }: { trace: BrowseTrace; cloudTraceId?: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const download = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const { blob, notInlined } = await exportBrowseTrace(trace, undefined, cloudTraceId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = traceFileName(trace);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (notInlined > 0) toast(`${notInlined} ${notInlined === 1 ? "frame stays a link" : "frames stay as links"}; the file needs network access to show ${notInlined === 1 ? "it" : "them"}.`);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <IconButton
      tooltip={failed ? "Download failed, try again" : "Download trace"}
      aria-label="Download trace"
      variant="ghost"
      size="icon"
      disabled={busy}
      onClick={() => void download()}
    >
      <DownloadSimpleIcon className="size-4" weight="light" />
    </IconButton>
  );
});
