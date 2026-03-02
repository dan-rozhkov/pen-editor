import { useState, useEffect, useRef } from "react";
import type { EmbedNode } from "@/types/scene";
import { PropertySection } from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";

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

  const fallbackCopy = (value: string): boolean => {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  };

  const handleCopyAsHtml = async () => {
    const value = node.htmlContent ?? "";
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        setCopyStatus("copied");
        resetCopyStatus();
        return;
      }
      const copied = fallbackCopy(value);
      setCopyStatus(copied ? "copied" : "error");
      resetCopyStatus();
    } catch {
      const copied = fallbackCopy(value);
      setCopyStatus(copied ? "copied" : "error");
      resetCopyStatus();
    }
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
