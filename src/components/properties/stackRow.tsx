import { useState, type DragEvent, type ReactNode } from "react";
import clsx from "clsx";
import type { Paint, PaintBlendMode } from "@/types/scene";
import { PAINT_BLEND_MODES } from "@/types/scene";
import { IconButton } from "@/components/ui/IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DotsSixVertical, DropHalfIcon, Eye, EyeSlash, MinusIcon } from "@phosphor-icons/react";
import { buildCSSGradient } from "@/utils/gradientUtils";

// --- Shared pieces moved from FillSection.tsx (also used by StrokeSection) ---

// Derived from the canonical blend-mode list ("color-dodge" → "Color Dodge").
export const BLEND_MODE_OPTIONS: { value: PaintBlendMode; label: string }[] =
  PAINT_BLEND_MODES.map((mode) => ({
    value: mode,
    label: mode
      .split("-")
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(" "),
  }));

function blendModeLabel(mode: PaintBlendMode | undefined): string {
  return BLEND_MODE_OPTIONS.find((option) => option.value === (mode ?? "normal"))?.label ?? "Normal";
}

export function BlendModeDropdown({
  value,
  onChange,
}: {
  value: PaintBlendMode | undefined;
  onChange: (value: PaintBlendMode) => void;
}) {
  const label = blendModeLabel(value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton
            type="button"
            variant="ghost"
            size="icon-sm"
            tooltip={`Blend mode: ${label}`}
            className="text-text-primary hover:bg-secondary"
          >
            <DropHalfIcon />
          </IconButton>
        }
      />

      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={value ?? "normal"}
          onValueChange={(next) => onChange(next as PaintBlendMode)}
        >
          {BLEND_MODE_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Small color/gradient/image preview swatch for a paint row. */
export function PaintSwatch({ paint }: { paint: Paint }) {
  let style: React.CSSProperties;
  if (paint.type === "solid") {
    style = { backgroundColor: paint.color };
  } else if (paint.type === "gradient") {
    if (paint.gradient.type === "radial") {
      const stops = [...paint.gradient.stops]
        .sort((a, b) => a.position - b.position)
        .map((s) => `${s.color} ${Math.round(s.position * 100)}%`)
        .join(", ");
      style = { background: `radial-gradient(circle, ${stops})` };
    } else {
      style = { background: buildCSSGradient(paint.gradient.stops) };
    }
  } else if (paint.type === "pattern" && paint.pattern.url) {
    // Approximate the tile's actual scale: clamp so the swatch preview stays
    // legible at both extremes (a huge tile would otherwise render as one
    // solid color; a tiny one as unrecognizable noise).
    const scalePercent = Math.round(Math.min(1, Math.max(0.1, paint.pattern.scale ?? 1)) * 50);
    style = {
      backgroundImage: `url(${paint.pattern.url})`,
      backgroundSize: `${scalePercent}%`,
      backgroundRepeat: "repeat",
    };
  } else if (paint.type === "image" && paint.image.url) {
    style = {
      backgroundImage: `url(${paint.image.url})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  } else if (paint.type === "video" && paint.video.src) {
    // Checkerboard placeholder swatch — a poster frame would require decoding
    // the video; the row label ("Video") disambiguates it.
    style = {
      background: "repeating-conic-gradient(#bbb 0% 25%, #eee 0% 50%) 50% / 6px 6px",
    };
  } else {
    style = {
      background: "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 6px 6px",
    };
  }
  return (
    <div
      className="h-4 w-4 shrink-0 rounded border border-border-default"
      style={style}
    />
  );
}

export const FILL_ROW_TRIGGER_CLASS =
  "flex min-w-0 flex-1 items-center gap-2 rounded bg-secondary px-1.5 py-1 text-left text-secondary-foreground hover:bg-secondary data-popup-open:bg-secondary";

// --- Drag-to-reorder hook (array-index space) ---

export interface DragReorderState {
  canReorder: boolean;
  rowDragProps: (arrayIndex: number) => {
    isDropTarget: boolean;
    isDragging: boolean;
    onDragOver: (e: DragEvent<HTMLDivElement>) => void;
    onDrop: () => void;
  };
  handleDragProps: (arrayIndex: number) => {
    draggable: boolean;
    onDragStart: (e: DragEvent<HTMLDivElement>) => void;
    onDragEnd: () => void;
  };
}

/**
 * Drag-to-reorder state shared by the Fill/Stroke/Effects paint-stack rows.
 * Operates in array-index space: `onMove(from, delta)` is called with the
 * same `(index, delta)` shape `moveItem` expects — i.e. on drop the caller
 * gets `onMove(dragIndex, target - dragIndex)`, matching
 * `moveItem(items, dragIndex, target - dragIndex)` exactly.
 */
// eslint-disable-next-line react-refresh/only-export-components -- hook lives beside StackRowShell by design (see Step 1 of plans/017)
export function useDragReorder(
  count: number,
  onMove: (from: number, delta: number) => void,
): DragReorderState {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const canReorder = count > 1;

  const handleDrop = (target: number) => {
    if (dragIndex !== null && dragIndex !== target) {
      onMove(dragIndex, target - dragIndex);
    }
    setDragIndex(null);
    setDropIndex(null);
  };

  const rowDragProps = (arrayIndex: number) => ({
    isDropTarget: dropIndex === arrayIndex && dragIndex !== null && dragIndex !== arrayIndex,
    isDragging: dragIndex === arrayIndex,
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (dragIndex !== null) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropIndex(arrayIndex);
      }
    },
    onDrop: () => handleDrop(arrayIndex),
  });

  const handleDragProps = (arrayIndex: number) => ({
    draggable: canReorder,
    onDragStart: (e: DragEvent<HTMLDivElement>) => {
      if (!canReorder) return;
      e.dataTransfer.effectAllowed = "move";
      setDragIndex(arrayIndex);
    },
    onDragEnd: () => {
      setDragIndex(null);
      setDropIndex(null);
    },
  });

  return { canReorder, rowDragProps, handleDragProps };
}

// --- Shared row shell ---

interface StackRowShellProps {
  arrayIndex: number;
  canReorder: boolean;
  drag: DragReorderState;
  visible: boolean;
  onToggleVisible: () => void;
  onRemove: () => void;
  /** Noun for the visibility/remove tooltips, e.g. "fill" | "stroke" | "effect". */
  itemLabel: string;
  triggerContent: ReactNode; // swatch + summary
  triggerTitle: string; // "Edit fill" | "Edit stroke" | "Edit effect"
  /** Override for FILL_ROW_TRIGGER_CLASS — only when the visual result must differ. */
  triggerClassName?: string;
  popoverTitle: ReactNode; // dragHandleContent
  trailing?: ReactNode; // OverrideIndicator slot
  children: ReactNode; // popover body (per-section)
}

/**
 * One row of a paint/effect stack: drag handle + popover trigger (swatch +
 * summary) + visibility/remove buttons. The reversed render order (last
 * array element is the top row) lives in each section's `.map().reverse()`
 * call, not here — this component only knows about `arrayIndex`.
 */
export function StackRowShell({
  arrayIndex,
  canReorder,
  drag,
  visible,
  onToggleVisible,
  onRemove,
  itemLabel,
  triggerContent,
  triggerTitle,
  triggerClassName = FILL_ROW_TRIGGER_CLASS,
  popoverTitle,
  trailing,
  children,
}: StackRowShellProps) {
  const rowDragProps = drag.rowDragProps(arrayIndex);
  const handleDragProps = drag.handleDragProps(arrayIndex);

  return (
    <div
      className={clsx(
        "group/stack-row relative flex items-center gap-1 rounded",
        rowDragProps.isDropTarget && "ring-1 ring-border-hover",
        rowDragProps.isDragging && "opacity-50",
      )}
      onDragOver={rowDragProps.onDragOver}
      onDrop={rowDragProps.onDrop}
    >
      {/* Drag handle — reorder the stack by dragging. `canReorder` (not the
          hook's own count-derived value) is the source of truth here, so a
          caller can pass a real `drag` object but still force the handle
          off (EffectsSection does this to keep DnD disabled today). */}
      <div
        draggable={canReorder}
        onDragStart={handleDragProps.onDragStart}
        onDragEnd={handleDragProps.onDragEnd}
        className={clsx(
          "absolute left-[-16px] top-1/2 flex h-6 w-4 -translate-y-1/2 items-center justify-center text-text-primary opacity-0 transition-opacity",
          canReorder
            ? "cursor-grab group-hover/stack-row:opacity-100 active:cursor-grabbing"
            : "pointer-events-none",
        )}
        title={canReorder ? "Drag to reorder" : undefined}
      >
        <DotsSixVertical size={16} />
      </div>

      {/* Compact trigger: swatch + summary opens the detail popover */}
      <Popover>
        <PopoverTrigger className={triggerClassName} title={triggerTitle}>
          {triggerContent}
        </PopoverTrigger>
        <PopoverContent draggable dragHandleContent={popoverTitle}>
          {children}
        </PopoverContent>
      </Popover>

      <IconButton
        variant="ghost"
        size="icon-sm"
        onClick={onToggleVisible}
        tooltip={visible ? `Hide ${itemLabel}` : `Show ${itemLabel}`}
      >
        {visible ? <Eye /> : <EyeSlash />}
      </IconButton>
      <IconButton variant="ghost" size="icon-sm" onClick={onRemove} tooltip={`Remove ${itemLabel}`}>
        <MinusIcon />
      </IconButton>

      {trailing}
    </div>
  );
}
