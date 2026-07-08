import { useState, useEffect, useRef } from "react";
import type { EmbedNode } from "@/types/scene";
import { PropertySection } from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { writeTextToClipboard } from "@/utils/clipboard";

interface EmbedContentSectionProps {
  node: EmbedNode;
}

export function EmbedContentSection({ node }: EmbedContentSectionProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [converting, setConverting] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      clearTimeout(copyResetRef.current);
    };
  }, []);

  const resetCopyStatus = () => {
    clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => {
      setCopyStatus("idle");
    }, 1200);
  };

  const handleCopyAsHtml = async () => {
    const value = node.htmlContent ?? "";
    const copied = await writeTextToClipboard(value);
    setCopyStatus(copied ? "copied" : "error");
    resetCopyStatus();
  };

  const handleConvertToDesign = async () => {
    setConverting(true);
    try {
      const newFrameId = await useSceneStore.getState().convertEmbedToDesign(node.id);
      if (newFrameId) {
        useSelectionStore.getState().setSelectedIds([newFrameId]);
      }
    } finally {
      setConverting(false);
    }
  };

  return (
    <PropertySection title="Embed">
      <div className="flex flex-col gap-1.5">
        <Button onClick={handleCopyAsHtml} variant="secondary" className="w-full">
          {copyStatus === "copied"
            ? "Copied"
            : copyStatus === "error"
              ? "Copy failed"
              : "Copy as HTML"}
        </Button>
        <Button onClick={handleConvertToDesign} variant="secondary" className="w-full" disabled={converting}>
          {converting ? "Converting..." : "Convert to Design"}
        </Button>
      </div>
    </PropertySection>
  );
}
