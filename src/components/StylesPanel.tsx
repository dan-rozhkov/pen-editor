import { useState, useRef, useEffect } from "react";
import { useStyleStore } from "@/store/styleStore";
import {
  generateFillStyleId,
  generateEffectStyleId,
  type FillStyle,
  type EffectStyle,
} from "@/types/style";
import type { Paint } from "@/types/scene";
import { createSolidPaint, createShadowEffect } from "@/utils/fillUtils";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { CustomColorPicker } from "./ui/ColorPicker";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { buildCSSGradient } from "@/utils/gradientUtils";

/** Inline editable name cell (mirrors TextStylesPanel/VariablesPanel EditableCell). */
function EditableName({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="w-full bg-secondary rounded px-2 py-1 text-xs text-text-primary outline-none"
      />
    );
  }

  return (
    <span
      className="text-xs text-text-primary truncate cursor-text hover:bg-secondary block px-2 py-1 rounded"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
    >
      {value || "(unnamed)"}
    </span>
  );
}

/** Read-only preview swatch for any paint kind (mirrors FillSection's PaintSwatch). */
function StyleSwatch({ paint }: { paint: Paint }) {
  let style: React.CSSProperties;
  if (paint.type === "solid") {
    style = { backgroundColor: paint.color };
  } else if (paint.type === "gradient") {
    style = { background: buildCSSGradient(paint.gradient.stops) };
  } else if (paint.type === "image" && paint.image.url) {
    style = { backgroundImage: `url(${paint.image.url})`, backgroundSize: "cover", backgroundPosition: "center" };
  } else if (paint.type === "pattern" && paint.pattern.url) {
    style = { backgroundImage: `url(${paint.pattern.url})`, backgroundSize: "50%", backgroundRepeat: "repeat" };
  } else {
    style = { background: "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 6px 6px" };
  }
  return <div className="h-5 w-5 shrink-0 rounded border border-border-default" style={style} />;
}

function paintTypeLabel(paint: Paint): string {
  if (paint.type === "solid") return paint.color.toUpperCase();
  if (paint.type === "gradient") return paint.gradient.type === "radial" ? "Radial gradient" : "Linear gradient";
  if (paint.type === "image") return "Image";
  return "Pattern";
}

function FillStyleRow({ style }: { style: FillStyle }) {
  const updateFillStyle = useStyleStore((s) => s.updateFillStyle);
  const deleteFillStyle = useStyleStore((s) => s.deleteFillStyle);
  const [hovered, setHovered] = useState(false);
  const paint = style.paint;

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 border-b border-border-light hover:bg-secondary/40"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {paint.type === "solid" ? (
        <CustomColorPicker
          value={paint.color}
          onChange={(color) => updateFillStyle(style.id, { paint: { ...paint, color } })}
        />
      ) : (
        <StyleSwatch paint={paint} />
      )}
      <div className="min-w-0 flex-1">
        <EditableName value={style.name} onCommit={(name) => updateFillStyle(style.id, { name })} />
      </div>
      <span className="text-[11px] text-text-muted font-mono truncate w-28 text-right">
        {paintTypeLabel(paint)}
      </span>
      <button
        className={
          "p-1 rounded hover:bg-white/10 text-text-muted hover:text-red-400 transition-colors " +
          (hovered ? "opacity-100" : "opacity-0")
        }
        onClick={() => deleteFillStyle(style.id)}
        title="Delete fill style"
      >
        <TrashIcon className="size-3.5" />
      </button>
    </div>
  );
}

function EffectStyleRow({ style }: { style: EffectStyle }) {
  const updateEffectStyle = useStyleStore((s) => s.updateEffectStyle);
  const deleteEffectStyle = useStyleStore((s) => s.deleteEffectStyle);
  const [hovered, setHovered] = useState(false);

  const firstShadow = style.effects.find((e) => e.type === "shadow");
  const summary = style.effects
    .map((e) => (e.type === "blur" ? "Blur" : e.shadowType === "inner" ? "Inner shadow" : "Drop shadow"))
    .join(", ");

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 border-b border-border-light hover:bg-secondary/40"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {firstShadow ? (
        <CustomColorPicker
          value={firstShadow.color}
          onChange={(color) =>
            updateEffectStyle(style.id, {
              effects: style.effects.map((e) => (e === firstShadow ? { ...e, color } : e)),
            })
          }
        />
      ) : (
        <div className="h-5 w-5 shrink-0 rounded border border-border-default bg-secondary" />
      )}
      <div className="min-w-0 flex-1">
        <EditableName value={style.name} onCommit={(name) => updateEffectStyle(style.id, { name })} />
      </div>
      <span className="text-[11px] text-text-muted truncate w-28 text-right">{summary || "Empty"}</span>
      <button
        className={
          "p-1 rounded hover:bg-white/10 text-text-muted hover:text-red-400 transition-colors " +
          (hovered ? "opacity-100" : "opacity-0")
        }
        onClick={() => deleteEffectStyle(style.id)}
        title="Delete effect style"
      >
        <TrashIcon className="size-3.5" />
      </button>
    </div>
  );
}

interface StylesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StylesDialog({ open, onOpenChange }: StylesDialogProps) {
  const fillStyles = useStyleStore((s) => s.fillStyles);
  const effectStyles = useStyleStore((s) => s.effectStyles);
  const addFillStyle = useStyleStore((s) => s.addFillStyle);
  const addEffectStyle = useStyleStore((s) => s.addEffectStyle);

  const handleAddFill = () => {
    const paint: Paint = createSolidPaint("#4a90d9");
    addFillStyle({ id: generateFillStyleId(), name: `Color ${fillStyles.length + 1}`, paint });
  };

  const handleAddEffect = () => {
    addEffectStyle({
      id: generateEffectStyleId(),
      name: `Effect ${effectStyles.length + 1}`,
      effects: [createShadowEffect()],
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl max-h-[80vh] flex flex-col gap-0 p-0"
        showCloseButton={false}
        overlayClassName="backdrop-blur-none bg-black/40"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
          <DialogTitle>Styles</DialogTitle>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Fill styles */}
          <div className="flex items-center justify-between px-3 py-2 bg-surface-panel sticky top-0 z-10 border-b border-border-light">
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">
              Fill styles
            </span>
            <button
              className="p-1 rounded hover:bg-secondary transition-colors text-text-muted hover:text-text-primary"
              title="Add color style"
              onClick={handleAddFill}
            >
              <PlusIcon className="size-4" />
            </button>
          </div>
          {fillStyles.length === 0 ? (
            <div className="text-center text-text-disabled text-xs py-6">No fill styles yet</div>
          ) : (
            fillStyles.map((s) => <FillStyleRow key={s.id} style={s} />)
          )}

          {/* Effect styles */}
          <div className="flex items-center justify-between px-3 py-2 bg-surface-panel sticky top-0 z-10 border-b border-y border-border-light">
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">
              Effect styles
            </span>
            <button
              className="p-1 rounded hover:bg-secondary transition-colors text-text-muted hover:text-text-primary"
              title="Add effect style"
              onClick={handleAddEffect}
            >
              <PlusIcon className="size-4" />
            </button>
          </div>
          {effectStyles.length === 0 ? (
            <div className="text-center text-text-disabled text-xs py-6">No effect styles yet</div>
          ) : (
            effectStyles.map((s) => <EffectStyleRow key={s.id} style={s} />)
          )}
        </div>

        <div className="border-t border-border-light px-4 py-3 flex gap-4">
          <button
            className="flex items-center gap-2 text-xs text-text-muted hover:text-text-primary transition-colors"
            onClick={handleAddFill}
          >
            <PlusIcon className="size-4" weight="light" />
            Color style
          </button>
          <button
            className="flex items-center gap-2 text-xs text-text-muted hover:text-text-primary transition-colors"
            onClick={handleAddEffect}
          >
            <PlusIcon className="size-4" weight="light" />
            Effect style
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
