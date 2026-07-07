import { useRef } from "react";

/**
 * Shared "pick a file, read it as a data URL" hook behind ImageFillEditor's
 * and PatternFillEditor's upload controls — the two editors only differ in
 * what they do with the resulting data URL (imageFill vs pattern tile url).
 */
export function useFileUpload(onFile: (dataUrl: string) => void) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onFile(reader.result as string);
    };
    reader.readAsDataURL(file);
    // Reset so selecting the same file again still fires onChange.
    e.target.value = "";
  };

  return { fileInputRef, handleFileSelect };
}
