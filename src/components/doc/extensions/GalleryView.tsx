import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { NodeViewWrapper, useEditorState, type NodeViewProps } from "@tiptap/react";
import { CaretLeftIcon, CaretRightIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { clearOpenAdd, peekOpenAdd, parseGalleryImages, type GalleryImage } from "./docGallery";
import "./docGallery.css";

const isHttpUrl = (value: string): boolean => /^https?:\/\/\S+$/i.test(value);

const NAV_BUTTON = "absolute top-1/2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white";

/** Thumbnail grid. A click opens the lightbox; when the editor is editable each tile can be removed and a "+" tile adds a link. */
export function GalleryView({ node, updateAttributes, editor, selected, getPos }: NodeViewProps) {
  const images = useMemo(() => parseGalleryImages(node.attrs.images), [node.attrs.images]);
  const editable = useEditorState({ editor, selector: (state) => state.editor.isEditable });
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const cancelled = useRef(false);

  // The slash item inserts a selected, empty gallery and asks it (once) to open its URL field.
  useEffect(() => {
    // The request is only cleared once the field really opens: under StrictMode the first effect pass is discarded and its timer cancelled.
    if (!selected || !editor.isEditable || !peekOpenAdd(editor, getPos())) return;
    const timer = setTimeout(() => {
      clearOpenAdd(editor);
      cancelled.current = false;
      setValue("");
      setInvalid(false);
      setAdding(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [selected, editor, getPos]);

  const setImages = useCallback((next: GalleryImage[]) => updateAttributes({ images: next }), [updateAttributes]);
  const current = open !== null ? images[open] : undefined;

  const step = (delta: number) => setOpen((index) => (index === null || images.length < 2 ? index : (index + delta + images.length) % images.length));
  const onLightboxKey = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    }
  };

  const submit = () => {
    const src = value.trim();
    if (!src) {
      cancelled.current = true;
      setAdding(false);
      return;
    }
    if (!isHttpUrl(src)) {
      setInvalid(true);
      return;
    }
    setImages([...images, { src, alt: "" }]);
    cancelled.current = true;
    setAdding(false);
    setValue("");
    setInvalid(false);
  };

  return (
    <NodeViewWrapper className="doc-gallery" data-type="image-gallery" data-selected={selected ? "" : undefined}>
      <div className="doc-gallery-grid" contentEditable={false} role="group" aria-label="Image gallery">
        {images.map((image, index) => (
          <div className="doc-gallery-tile" key={`${index}-${image.src}`}>
            <button
              type="button"
              className="doc-gallery-open"
              aria-label={image.alt ? `Open image: ${image.alt}` : `Open image ${index + 1} of ${images.length}`}
              onClick={() => setOpen(index)}
            >
              <img src={image.src} alt={image.alt} loading="lazy" draggable={false} />
            </button>
            {editable && (
              <button type="button" className="doc-gallery-remove" aria-label="Remove image" onClick={() => setImages(images.filter((_, at) => at !== index))}>
                <XIcon size={12} weight="bold" />
              </button>
            )}
          </div>
        ))}
        {editable && !adding && (
          <button
            ref={addRef}
            type="button"
            className="doc-gallery-add"
            aria-label={images.length ? "Add image" : "Add images"}
            style={images.length ? undefined : { aspectRatio: "auto", minHeight: 64, flexDirection: "row" }}
            onClick={() => {
              cancelled.current = false;
              setValue("");
              setInvalid(false);
              setAdding(true);
            }}
          >
            <PlusIcon size={18} />
            {images.length === 0 && "Add images"}
          </button>
        )}
        {editable && adding && (
          <form
            className="doc-gallery-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <Input
              autoFocus
              aria-label="Image address"
              aria-invalid={invalid || undefined}
              placeholder="Paste an image link, then press Enter"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setInvalid(false);
              }}
              onBlur={() => {
                // Leaving the field keeps a valid link, closes an empty one and keeps an invalid one open with its error.
                if (cancelled.current) return;
                submit();
              }}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                cancelled.current = true;
                setAdding(false);
                requestAnimationFrame(() => addRef.current?.focus());
              }}
            />
            {invalid && <p className="text-destructive mt-1 text-xs">Use a link that starts with http:// or https://</p>}
          </form>
        )}
      </div>

      <Dialog open={open !== null && !!current} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent
          showCloseButton={false}
          overlayClassName="z-[10100] bg-black/95"
          aria-label="Image viewer"
          className="fixed top-0 left-0 z-[10100] flex h-screen w-screen max-w-none translate-x-0 translate-y-0 flex-col items-center justify-center gap-3 rounded-none bg-transparent p-0 text-white ring-0 sm:max-w-none"
          onKeyDown={onLightboxKey}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(null);
          }}
        >
          <DialogTitle className="sr-only">Image viewer</DialogTitle>
          <DialogDescription className="sr-only">{current?.alt || "Full size image"}</DialogDescription>
          {current && (
            <figure
              className="m-0 flex max-w-[90vw] flex-col items-center gap-2"
              onClick={(event) => {
                if (event.target === event.currentTarget) setOpen(null);
              }}
            >
              <img src={current.src} alt={current.alt} className="max-h-[85vh] max-w-[90vw] object-contain" />
              {current.alt && <figcaption className="max-w-[80vw] text-center text-sm text-white/80">{current.alt}</figcaption>}
            </figure>
          )}
          <span className="absolute top-4 left-4 text-sm text-white/70 tabular-nums" aria-live="polite">
            {open !== null ? `${open + 1} / ${images.length}` : ""}
          </span>
          <DialogClose aria-label="Close" className={cn(NAV_BUTTON, "top-6 right-4 -translate-y-1/2")}>
            <XIcon size={18} />
          </DialogClose>
          {images.length > 1 && (
            <>
              <button type="button" aria-label="Previous image" className={cn(NAV_BUTTON, "left-4")} onClick={() => step(-1)}>
                <CaretLeftIcon size={20} />
              </button>
              <button type="button" aria-label="Next image" className={cn(NAV_BUTTON, "right-4")} onClick={() => step(1)}>
                <CaretRightIcon size={20} />
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </NodeViewWrapper>
  );
}
