import { useMemo, useState } from "react";
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

  return (
    <PropertySection title="Showcase">
      <TextInput label="App name" value={appName} onChange={setAppName} placeholder="Name this app" />
      <div className="text-[10px] text-text-muted">
        {`Publishes ${screens.length} screen${screens.length === 1 ? "" : "s"} publicly to the gallery at /.`}
      </div>
      <Button
        onClick={onPublish}
        disabled={!canPublish}
        variant="outline"
        className="w-full min-w-0"
      >
        <span className="min-w-0 truncate">
          {status === "publishing" ? "Publishing…" : "Publish to Showcase"}
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
