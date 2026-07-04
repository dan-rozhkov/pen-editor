import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  PaperPlaneRightIcon,
  StopIcon,
  ImageIcon,
  XIcon,
} from "@phosphor-icons/react";
import { SlashCommandMenu } from "./SlashCommandMenu";
import type { SlashCommand } from "./slashCommands";
import type { AttachedImage, ChatLaunchPayload } from "@/types/chat";
import { useChatStore } from "@/store/chatStore";
import { modelSupportsVision } from "@/lib/chatModels";
import { useSelectionScreenshots } from "@/hooks/useSelectionScreenshots";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { OFFLINE_SEND_TITLE } from "@/lib/apiBase";

// Maximum images per message (mirrored by MAX_IMAGE_PARTS on the backend).
const MAX_IMAGES = 4;

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  // Returns whether the message was actually sent. ChatInput only clears
  // attachments/dismissed-selection on `true` — a `false` (offline, chat not
  // ready, …) leaves the draft and its attachments intact so the user can
  // retry once the underlying condition clears.
  onSubmit: (payload: ChatLaunchPayload) => boolean;
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
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const model = useChatStore((s) => s.model);
  const supportsVision = modelSupportsVision(model);
  // Sending always needs the backend — disable the send control while offline
  // (the pre-send guard in useDesignChat is kept as defense in depth).
  const isOnline = useOnlineStatus();

  // Screenshots of the currently selected canvas nodes, attached to the message
  // as visual context. The user can drop individual ones for the message they
  // are composing without changing the canvas selection.
  const selectionScreenshots = useSelectionScreenshots();
  const [dismissedSelection, setDismissedSelection] = useState<Set<string>>(
    () => new Set()
  );
  const visibleSelection = useMemo(
    () => selectionScreenshots.filter((s) => !dismissedSelection.has(s.nodeId)),
    [selectionScreenshots, dismissedSelection]
  );

  const dismissSelection = useCallback((nodeId: string) => {
    setDismissedSelection((prev) => new Set(prev).add(nodeId));
  }, []);

  // Forget dismissals for nodes that have left the selection, so re-selecting a
  // previously-dismissed node brings it back as context.
  const selectionIds = useMemo(
    () => selectionScreenshots.map((s) => s.nodeId),
    [selectionScreenshots]
  );
  useEffect(() => {
    setDismissedSelection((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(selectionIds);
      const next = new Set<string>();
      for (const id of prev) {
        if (present.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [selectionIds]);

  // Selection screenshots plus manual attachments can exceed the per-message
  // image limit; explicit attachments are always kept and the overflow (extra
  // selected elements) is dropped — warn so nothing disappears silently.
  const overImageLimit =
    supportsVision &&
    visibleSelection.length + attachedImages.length > MAX_IMAGES;

  // Extract slash query from input (e.g. "/aud" -> "aud", "/" -> "")
  const slashQuery = useMemo(() => {
    const match = input.match(/^\/(\S*)$/);
    return match ? match[1] : null;
  }, [input]);

  useEffect(() => {
    setShowSlashMenu(slashQuery !== null);
  }, [slashQuery]);

  const handleSlashSelect = useCallback(
    (cmd: SlashCommand) => {
      setInput(`/${cmd.name} `);
      setShowSlashMenu(false);
      textareaRef.current?.focus();
    },
    [setInput]
  );

  const handleSlashClose = useCallback(() => {
    setShowSlashMenu(false);
  }, []);

  const resize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 96)}px`;
    // Only show the scrollbar once content actually exceeds the max height;
    // otherwise the default `overflow: auto` renders a scrollbar even at a
    // single line due to line-height/subpixel rounding.
    ta.style.overflowY = ta.scrollHeight > 96 ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    resize();
  }, [input, resize]);

  const addImages = useCallback(
    async (files: FileList | File[]) => {
      if (!supportsVision) return;
      const newImages = await processFiles(files);
      if (newImages.length > 0) {
        setAttachedImages((prev) =>
          [...prev, ...newImages].slice(0, MAX_IMAGES)
        );
      }
    },
    [supportsVision]
  );

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const doSubmit = useCallback(
    () => {
      // Drop attachments the selected model can't read (a warning is shown
      // above the previews) so the request doesn't fail at the provider.
      // Explicit attachments are always kept; selection screenshots lead in
      // order but only fill the room left under the per-message limit, so the
      // user's own attachments are never silently displaced.
      const room = Math.max(0, MAX_IMAGES - attachedImages.length);
      const selectionImages: AttachedImage[] = supportsVision
        ? visibleSelection
            .slice(0, room)
            .map((s) => ({ dataUrl: s.dataUrl, name: s.name }))
        : [];
      const images = supportsVision
        ? [...selectionImages, ...attachedImages]
        : [];
      // Deliberately not gated on `isOnline`: the send button is already
      // disabled while offline, but Enter bypasses it. Calling onSubmit
      // unconditionally lets its offline guard (in useDesignChat) surface a
      // visible per-message error instead of Enter being a silent no-op.
      if ((input.trim() || images.length > 0) && !isLoading) {
        const didSend = onSubmit({
          text: input.trim(),
          images: images.length > 0 ? images : undefined,
        });
        // Only clear attachments once the message actually sent — a failed
        // send (offline, chat not ready, …) must leave them intact so the
        // user can retry without re-attaching everything.
        if (didSend) {
          setAttachedImages([]);
          // Reset per-message dismissals so the next message re-includes the
          // still-selected nodes.
          setDismissedSelection(new Set());
        }
      }
    },
    [input, attachedImages, visibleSelection, supportsVision, isLoading, onSubmit]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doSubmit();
      }
    },
    [doSubmit]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      doSubmit();
    },
    [doSubmit]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!supportsVision) return;
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
    [supportsVision, addImages]
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
      className={`relative border-t border-border-default px-3 py-2 ${isDragOver ? "bg-secondary" : ""}`}
    >
      {showSlashMenu && slashQuery !== null && (
        <SlashCommandMenu
          query={slashQuery}
          onSelect={handleSlashSelect}
          onClose={handleSlashClose}
        />
      )}

      {overImageLimit && (
        <div className="mb-2 text-xs text-amber-500">
          Only {MAX_IMAGES} images can be sent per message — extra selected
          elements won't be attached.
        </div>
      )}

      {/* Selected canvas elements, attached as visual context */}
      {visibleSelection.length > 0 && (
        <div className="mb-2">
          <div className="flex gap-2 flex-wrap">
            {visibleSelection.map((sel) => (
              <div
                key={sel.nodeId}
                title={sel.name}
                className="relative group w-12 h-12 rounded-md overflow-hidden bg-secondary"
              >
                <img
                  src={sel.dataUrl}
                  alt={sel.name}
                  className="w-full h-full object-contain"
                />
                <button
                  type="button"
                  onClick={() => dismissSelection(sel.nodeId)}
                  title="Remove from context"
                  className="absolute top-0 right-0 p-0.5 bg-black/60 rounded-bl text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <XIcon size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Image previews */}
      {attachedImages.length > 0 && !supportsVision && (
        <div className="mb-2 text-xs text-amber-500">
          The selected model can't read images — attachments won't be sent.
        </div>
      )}
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
          disabled={
            !supportsVision ||
            visibleSelection.length + attachedImages.length >= MAX_IMAGES
          }
          className="shrink-0 p-1.5 rounded-lg hover:bg-secondary text-text-muted disabled:text-text-disabled disabled:pointer-events-none transition-colors"
          title={
            !supportsVision
              ? "Selected model can't read images"
              : visibleSelection.length + attachedImages.length >= MAX_IMAGES
                ? `Max ${MAX_IMAGES} images`
                : "Attach image"
          }
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
            className="shrink-0 p-1.5 rounded-lg hover:bg-secondary text-text-muted transition-colors"
            title="Stop"
          >
            <StopIcon size={18} />
          </button>
        ) : (
          <button
            type="submit"
            disabled={
              !isOnline ||
              (!input.trim() &&
                attachedImages.length === 0 &&
                visibleSelection.length === 0)
            }
            className="shrink-0 p-1.5 rounded-lg hover:bg-secondary text-text-muted disabled:text-text-disabled transition-colors"
            title={isOnline ? "Send" : OFFLINE_SEND_TITLE}
          >
            <PaperPlaneRightIcon size={18} />
          </button>
        )}
      </div>
    </form>
  );
}
