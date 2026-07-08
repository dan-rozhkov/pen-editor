import { useState } from "react";
import { SparkleIcon, DeviceMobileIcon, DesktopIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { launchFirstDraftChat, type FirstDraftPlatform } from "@/lib/launchFirstDraftChat";

const PLATFORM_OPTIONS: { value: FirstDraftPlatform; label: string; icon: typeof DeviceMobileIcon }[] = [
  { value: "mobile", label: "Mobile", icon: DeviceMobileIcon },
  { value: "desktop", label: "Desktop", icon: DesktopIcon },
];

/**
 * Prominent "First Draft" entry point (Figma "First Draft" analog): the user
 * writes a one-sentence description, picks a platform, and this dispatches a
 * `/first-draft` message into a fresh chat via `launchFirstDraftChat`. Meant
 * to be shown before a chat has any messages (empty-chat state) so it's the
 * first thing a user sees when opening the Design Agent panel.
 */
export function FirstDraftEntry() {
  const [description, setDescription] = useState("");
  const [platform, setPlatform] = useState<FirstDraftPlatform>("mobile");

  const canSubmit = description.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    launchFirstDraftChat(description, platform);
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-default p-3">
      <div className="flex items-center gap-1.5 text-text-primary">
        <SparkleIcon className="size-4" />
        <span className="text-[13px] font-medium">First draft</span>
      </div>
      <p className="text-xs text-text-muted">
        Describe a screen in one sentence — the agent builds a full first draft with real structure.
      </p>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Describe the screen, e.g. 'a settings screen with account and notification sections'"
        rows={2}
        className="w-full resize-none rounded-md border border-border-default bg-transparent px-2.5 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-ring/30"
      />
      <div className="flex items-center gap-1.5">
        {PLATFORM_OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={platform === value}
            onClick={() => setPlatform(value)}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
              platform === value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border-default text-text-muted hover:bg-secondary",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>
      <Button onClick={handleSubmit} disabled={!canSubmit} className="justify-center">
        Generate first draft
      </Button>
    </div>
  );
}
