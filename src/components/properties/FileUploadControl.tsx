import type { RefObject } from "react";
import { Button } from "@/components/ui/button";

/**
 * Shared hidden-file-input + Upload/Replace trigger button, used by both
 * ImageFillEditor and PatternFillEditor (previously duplicated boilerplate).
 * Pair with `useFileUpload` for the actual file-read logic.
 */
export function FileUploadControl({
  fileInputRef,
  onFileSelect,
  hasValue,
  uploadLabel,
  replaceLabel,
  accept = "image/*",
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  hasValue: boolean;
  uploadLabel: string;
  replaceLabel: string;
  accept?: string;
}) {
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={onFileSelect}
      />
      <Button
        onClick={() => fileInputRef.current?.click()}
        variant="secondary"
        className="w-full"
      >
        {hasValue ? replaceLabel : uploadLabel}
      </Button>
    </>
  );
}
