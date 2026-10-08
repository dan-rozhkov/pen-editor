import { useMemo } from "react";
import { toast } from "sonner";
import { findPickedComponentRegion } from "@/lib/embedComponents";
import { goToMaster } from "@/lib/componentPanelActions";
import { detachInstance } from "@/lib/tools/components";
import { selectComponentRegistry } from "@/store/componentRegistry";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useReadOnly } from "@/hooks/useReadOnly";
import { Button } from "@/components/ui/button";
import { PropertySection } from "@/components/ui/PropertyInputs";

interface EmbedComponentRegionActionsProps {
  embedId: string;
  /** Shadow-DOM path of the picked element. */
  path: string;
  htmlContent: string;
}

/**
 * Shown for an element picked inside the managed zone of a component
 * instance: its look comes from the master, so offer the two ways forward
 * (edit the master, or detach this instance). Slot content edits normally and
 * shows nothing here.
 */
export function EmbedComponentRegionActions({ embedId, path, htmlContent }: EmbedComponentRegionActionsProps) {
  const readOnly = useReadOnly();
  const region = useMemo(() => findPickedComponentRegion(htmlContent, path), [htmlContent, path]);
  if (!region || region.zone !== "managed") return null;
  const master = selectComponentRegistry().get(region.key);
  if (!master) return null;

  async function handleDetach() {
    if (!region) return;
    const result = JSON.parse(await detachInstance({ nodeId: embedId, selector: region.regionSelector })) as {
      error?: string;
    };
    if (result.error) toast.error(result.error);
    else {
      useEmbedPickerStore.getState().clearSelection();
      toast.success("Detached instance. It is now plain HTML.");
    }
  }

  return (
    <div data-testid="embed-component-region-actions">
      <PropertySection title="Component">
        <p className="text-[11px] text-text-muted">
          Part of the main component {master.meta.name}. Edit the main component to change it everywhere.
        </p>
        <div className="flex flex-wrap gap-1">
          <Button variant="outline" size="sm" onClick={() => goToMaster(region.key)}>
            Edit main component
          </Button>
          <Button variant="outline" size="sm" disabled={readOnly} onClick={() => void handleDetach()}>
            Detach
          </Button>
        </div>
      </PropertySection>
    </div>
  );
}
