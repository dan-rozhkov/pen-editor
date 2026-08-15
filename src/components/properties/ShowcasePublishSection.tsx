import { useMemo, useState } from "react";
import { SlidersHorizontalIcon } from "@phosphor-icons/react";
import { track } from "@/lib/analytics";
import {
  publishScreensToShowcase,
  inferPlatformForSizes,
  sortByReadingOrder,
  screenTitleFor,
  type ShowcasePublishScreen,
} from "@/lib/showcasePublish";
import { PropertySection, TextInput } from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useReadOnly } from "@/hooks/useReadOnly";

type Status = "idle" | "publishing" | "done" | "error";

export interface ShowcaseScreenCandidate {
  nodeId: string;
  name: string | undefined;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Multi(or single)-select property panel section shown when every selected
 * node is an `embed` or a `frame` (see `PropertiesPanel.tsx`). Deterministic
 * counterpart to the AI agent's `publish_to_showcase` tool: same pipeline
 * (`src/lib/showcasePublish.ts`), driven by a button instead of the model.
 * UI-only wrapper over that tested core — not unit-tested itself (network +
 * canvas rasterization side effects), same idiom as `PrototypeExportSection`.
 */
export function ShowcasePublishSection({
  screens,
  defaultName,
}: {
  screens: ShowcaseScreenCandidate[];
  defaultName: string;
}) {
  const readOnly = useReadOnly();
  const [appName, setAppName] = useState(defaultName);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  // Selection order isn't meaningful — publish left-to-right, top-to-bottom
  // reading order instead, and cover the first screen in that order.
  const orderedScreens = useMemo(() => sortByReadingOrder(screens), [screens]);

  const sizeValidation = useMemo(
    () =>
      inferPlatformForSizes(
        orderedScreens.map((s, i) => ({
          title: screenTitleFor(s.name, i),
          width: s.width,
          height: s.height,
        })),
      ),
    [orderedScreens],
  );

  const canPublish = !readOnly && appName.trim().length > 0 && sizeValidation.ok && status !== "publishing";
  const publishLabel =
    orderedScreens.length === 1
      ? "Publish to showcase"
      : `Publish ${orderedScreens.length} screens`;

  async function onPublish() {
    if (readOnly || !sizeValidation.ok) return;
    track("showcase_publish_clicked", { screen_count: orderedScreens.length });
    setStatus("publishing");
    setError(null);

    const publishScreens: ShowcasePublishScreen[] = orderedScreens.map((s, i) => ({
      nodeId: s.nodeId,
      title: screenTitleFor(s.name, i),
      cover: i === 0,
    }));

    try {
      const outcome = await publishScreensToShowcase({
        theme: appName.trim(),
        platform: sizeValidation.platform,
        screens: publishScreens,
      });

      if (outcome.ok) {
        setStatus("done");
      } else {
        setError(outcome.error);
        setStatus("error");
      }
    } catch (e) {
      // publishScreensToShowcase is documented to never throw, but the
      // button must never get stuck on "Publishing…" even if that contract
      // is violated somewhere down the line.
      setError(e instanceof Error ? e.message : "Failed to publish");
      setStatus("error");
    } finally {
      setStatus((s) => (s === "publishing" ? "error" : s));
    }
  }

  const settings = (
    <Popover>
      <PopoverTrigger
        render={
          <IconButton variant="ghost" size="icon-sm" tooltip="Showcase settings">
            <SlidersHorizontalIcon />
          </IconButton>
        }
      />
      <PopoverContent
        side="left"
        align="start"
        draggable
        dragHandleContent={
          <span className="text-[11px] font-semibold text-text-primary">Showcase settings</span>
        }
      >
        <TextInput
          label="App name"
          value={appName}
          onChange={setAppName}
          placeholder="Name this app"
        />
      </PopoverContent>
    </Popover>
  );

  return (
    <PropertySection title="Showcase" action={settings}>
      <Button
        onClick={onPublish}
        disabled={!canPublish}
        variant="outline"
        className="w-full min-w-0"
      >
        <span className="min-w-0 truncate">
          {status === "publishing" ? "Publishing…" : publishLabel}
        </span>
      </Button>
      {!sizeValidation.ok && (
        <div className="text-[10px] text-destructive">{sizeValidation.error}</div>
      )}
      {status === "error" && error && (
        <div className="text-[10px] text-destructive">{error}</div>
      )}
      {status === "done" && (
        <div className="text-[10px] text-text-muted">Published to the showcase.</div>
      )}
    </PropertySection>
  );
}
