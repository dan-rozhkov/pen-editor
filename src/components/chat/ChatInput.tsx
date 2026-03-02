import { useState, useRef, useCallback, useEffect } from "react";
import {
  PaperPlaneRightIcon,
  StopIcon,
  ImageIcon,
  XIcon,
} from "@phosphor-icons/react";

export interface AttachedImage {
  dataUrl: string;
  name: string;
}

const MAX_IMAGES = 3;

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  onSubmit: (e: React.FormEvent, images?: AttachedImage[]) => void;
  isLoading: boolean;
  stop: () => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function processFiles(files: FileList | File[]): Promise<AttachedImage[]> {
  return Promise.all(
    Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .map(async (f) => ({ dataUrl: await readFileAsDataUrl(f), name: f.name }))
  );
}

export function ChatInput({
  input,
  setInput,
  onSubmit,
  isLoading,
  stop,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const resize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 96)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [input, resize]);

  const addImages = useCallback(async (files: FileList | File[]) => {
    const newImages = await processFiles(files);
    if (newImages.length > 0) {
      setAttachedImages((prev) => [...prev, ...newImages].slice(0, MAX_IMAGES));
    }
  }, []);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const doSubmit = useCallback(
    (e: React.SyntheticEvent) => {
      if ((input.trim() || attachedImages.length > 0) && !isLoading) {
        onSubmit(
          e as React.FormEvent,
          attachedImages.length > 0 ? attachedImages : undefined,
        );
        setAttachedImages([]);
      }
    },
    [input, attachedImages, isLoading, onSubmit]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doSubmit(e);
      }
    },
    [doSubmit]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      doSubmit(e);
    },
    [doSubmit]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        addImages(imageFiles);
      }
    },
    [addImages]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver((prev) => prev || true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        addImages(e.dataTransfer.files);
      }
    },
    [addImages]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addImages(e.target.files);
      }
      e.target.value = "";
    },
    [addImages]
  );

  return (
    <form
      onSubmit={handleSubmit}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`border-t border-border-default px-3 py-2 ${isDragOver ? "bg-surface-hover" : ""}`}
    >
      {/* Image previews */}
      {attachedImages.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {attachedImages.map((img, i) => (
            <div
              key={i}
              className="relative group w-12 h-12 rounded-md overflow-hidden border border-border-default"
            >
              <img
                src={img.dataUrl}
                alt={img.name}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute top-0 right-0 p-0.5 bg-black/60 rounded-bl text-white opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <XIcon size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Attach image button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={attachedImages.length >= MAX_IMAGES}
          className="shrink-0 p-1.5 rounded-lg hover:bg-surface-hover text-text-muted disabled:text-text-disabled disabled:pointer-events-none transition-colors"
          title={attachedImages.length >= MAX_IMAGES ? `Max ${MAX_IMAGES} images` : "Attach image"}
        >
          <ImageIcon size={18} weight="light" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            resize();
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Ask the design agent..."
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-text-primary placeholder:text-text-disabled outline-none min-h-[24px] max-h-[96px] py-1 leading-normal"
        />
        {isLoading ? (
          <button
            type="button"
            onClick={stop}
            className="shrink-0 p-1.5 rounded-lg hover:bg-surface-hover text-text-muted transition-colors"
            title="Stop"
          >
            <StopIcon size={18} />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim() && attachedImages.length === 0}
            className="shrink-0 p-1.5 rounded-lg hover:bg-surface-hover text-text-muted disabled:text-text-disabled transition-colors"
            title="Send"
          >
            <PaperPlaneRightIcon size={18} />
          </button>
        )}
      </div>
    </form>
  );
}
