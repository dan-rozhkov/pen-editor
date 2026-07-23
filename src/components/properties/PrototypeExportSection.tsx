import { useState } from "react";
import { generatePrototypeZip, type PrototypeEmbed } from "@/utils/prototype";
import { PropertySection } from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";

type Status = "idle" | "linking" | "done" | "error";

/**
 * Multi-select property panel section shown when every selected node is an
 * `embed` (see `PropertiesPanel.tsx`). Wires the selected screens into a
 * clickable, self-contained `.zip` prototype via `generatePrototypeZip`
 * (extract → AI link graph → apply → zip → download). UI-only wrapper over
 * the tested `src/utils/prototype` core — not unit-tested itself (network +
 * file download side effects), covered by manual/e2e verification.
 */
export function PrototypeExportSection({ embeds }: { embeds: PrototypeEmbed[] }) {
  const [status, setStatus] = useState<Status>("idle");

  async function onExport() {
    setStatus("linking");
    try {
      await generatePrototypeZip(embeds);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  return (
    <PropertySection title="Prototype">
      <Button
        onClick={onExport}
        disabled={status === "linking"}
        variant="outline"
        className="w-full min-w-0"
      >
        <span className="min-w-0 truncate">
          {status === "linking" ? "Linking screens…" : "Export prototype (.zip)"}
        </span>
      </Button>
      {status === "error" && (
        <div className="text-[10px] text-destructive">Failed to build prototype. Try again.</div>
      )}
      {status === "done" && (
        <div className="text-[10px] text-text-muted">Prototype exported.</div>
      )}
    </PropertySection>
  );
}
