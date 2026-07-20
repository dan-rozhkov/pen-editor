import { useState, useEffect, useRef } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import type { EmbedNode } from "@/types/scene";
import { PropertySection } from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { writeTextToClipboard } from "@/utils/clipboard";
import { useConvertEmbedToDesign } from "@/components/properties/useConvertEmbedToDesign";

interface EmbedContentSectionProps {
  node: EmbedNode;
}

export function EmbedContentSection({ node }: EmbedContentSectionProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const { converting, convertToDesign: handleConvertToDesign } = useConvertEmbedToDesign(node.id);
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
        <Button
          onClick={handleConvertToDesign}
          variant="secondary"
          className="w-full"
          aria-label={converting ? "Converting to Design" : undefined}
        >
          {converting ? (
            <CircleNotch
              aria-hidden="true"
              className="animate-spin"
              weight="thin"
            />
          ) : (
            "Convert to Design"
          )}
        </Button>
      </div>
    </PropertySection>
  );
}
