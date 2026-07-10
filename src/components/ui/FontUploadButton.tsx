import { useRef } from "react";
import { MonitorArrowUpIcon } from "@phosphor-icons/react";
import { IconButton } from "./IconButton";
import { useCustomFontStore } from "@/store/customFontStore";

interface FontUploadButtonProps {
  /** Called with the registered family name once a font file is loaded. */
  onUploaded?: (family: string) => void;
}

/**
 * Icon button that opens the OS file picker (`.ttf/.otf/.woff/.woff2`) and
 * registers the chosen font via `customFontStore`. Lives in the Typography
 * section header (next to the text-styles `+`) — the font picker only lists
 * fonts, it no longer hosts the upload entry.
 */
export function FontUploadButton({ onUploaded }: FontUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const addCustomFont = useCustomFontStore((s) => s.addCustomFont);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset immediately so re-selecting the same file later still fires onChange.
    e.target.value = "";
    if (!file) return;
    const family = await addCustomFont(file);
    if (family) {
      onUploaded?.(family);
    }
  };

  return (
    <>
      <IconButton
        variant="ghost"
        size="icon-sm"
        tooltip="Upload font"
        onClick={handleClick}
      >
        <MonitorArrowUpIcon />
      </IconButton>
      <input
        ref={inputRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        className="hidden"
        onChange={handleChange}
      />
    </>
  );
}
