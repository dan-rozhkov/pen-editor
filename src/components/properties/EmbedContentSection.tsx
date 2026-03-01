import { useState, useEffect, useRef } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";
import clsx from "clsx";
import type { SceneNode, EmbedNode } from "@/types/scene";
import { PropertySection } from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";

interface EmbedContentSectionProps {
  node: EmbedNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
}

export function EmbedContentSection({ node, onUpdate }: EmbedContentSectionProps) {
  const [localValue, setLocalValue] = useState(node.htmlContent);
  const [isAccordionOpen, setIsAccordionOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [converting, setConverting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const copyResetRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setLocalValue(node.htmlContent);
  }, [node.htmlContent]);

  useEffect(() => {
    return () => {
      clearTimeout(copyResetRef.current);
      clearTimeout(debounceRef.current);
    };
  }, []);

  const handleChange = (value: string) => {
    setLocalValue(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onUpdate({ htmlContent: value } as Partial<SceneNode>);
    }, 300);
  };

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
    const value = localValue ?? "";
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
        <div>
          <button
            type="button"
            onClick={() => setIsAccordionOpen((prev) => !prev)}
            className={clsx(
              "group flex w-full items-center cursor-pointer h-6 px-1.5",
              "hover:bg-surface-elevated",
            )}
            aria-expanded={isAccordionOpen}
            aria-label="Toggle HTML content"
          >
            <span className="mr-1 flex items-center justify-center">
              <CaretRightIcon
                size={10}
                className={clsx(
                  "w-2.5 h-2.5 text-text-muted transition-transform",
                  isAccordionOpen && "rotate-90",
                )}
                weight="bold"
              />
            </span>
            <span className="text-xs whitespace-nowrap text-text-secondary">
              HTML Content
            </span>
          </button>
          {isAccordionOpen && (
            <div className="pt-1">
              <Textarea
                value={localValue}
                onChange={(e) => handleChange(e.target.value)}
                className="min-h-28 font-mono resize-y"
                spellCheck={false}
                placeholder="<div>Your HTML here</div>"
              />
            </div>
          )}
        </div>
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
