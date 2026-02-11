import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import {
  ColorPicker as AriaColorPicker,
  ColorArea,
  ColorThumb,
  ColorSlider,
  SliderTrack,
  ColorField,
  Input,
  parseColor,
  type Color,
} from "react-aria-components";
import { Eyedropper } from "@phosphor-icons/react";

const supportsEyeDropper = typeof window !== "undefined" && "EyeDropper" in window;

interface CustomColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  swatchSize?: "sm" | "md";
}

export function CustomColorPicker({
  value,
  onChange,
  swatchSize = "md",
}: CustomColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

  const safeValue = value || "#000000";

  let color: Color;
  try {
    color = parseColor(safeValue);
  } catch {
    color = parseColor("#000000");
  }

  const handleChange = useCallback(
    (c: Color) => {
      onChange(c.toString("hex"));
    },
    [onChange],
  );

  const updatePopoverPosition = useCallback(() => {
    if (!open) return;
    const trigger = containerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;

    const anchor =
      (trigger.closest("[data-slot='input-group']") as HTMLElement | null) ||
      trigger;
    const anchorRect = anchor.getBoundingClientRect();
    const gap = 20;
    const popoverWidth = popover.offsetWidth;
    const popoverHeight = popover.offsetHeight;
    const maxTop = Math.max(8, window.innerHeight - popoverHeight - 8);
    const top = Math.min(Math.max(anchorRect.top, 8), maxTop);
    const left = Math.max(8, anchorRect.left - popoverWidth - gap);

    setPopoverStyle({ position: "fixed", top, left });
  }, [open]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const clickedTrigger = containerRef.current?.contains(target);
      const clickedPopover = popoverRef.current?.contains(target);
      if (!clickedTrigger && !clickedPopover) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePopoverPosition();
  }, [open, updatePopoverPosition]);

  useEffect(() => {
    if (!open) return;
    const handleScroll = () => updatePopoverPosition();
    window.addEventListener("resize", handleScroll);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("resize", handleScroll);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, updatePopoverPosition]);

  const sizeClass = swatchSize === "sm" ? "w-3 h-3" : "w-4 h-4";

  return (
    <div className="relative flex cursor-default" ref={containerRef}>
      {/* Swatch trigger */}
      <button
        type="button"
        className={`${sizeClass} rounded-sm cursor-pointer shrink-0`}
        style={{ backgroundColor: safeValue }}
        onClick={() => setOpen(!open)}
        aria-label="Pick color"
      />

      {/* Popover */}
      {open &&
        mounted &&
        createPortal(
        <div
          ref={popoverRef}
          style={popoverStyle}
          className="z-50 bg-surface-panel border border-border-light rounded-xl shadow-lg p-3 flex flex-col gap-2 w-[200px]"
        >
          <AriaColorPicker value={color} onChange={handleChange}>
            {/* Saturation / Brightness area */}
            <ColorArea
              colorSpace="hsb"
              xChannel="saturation"
              yChannel="brightness"
              aria-label="Color"
              className="w-full h-[140px] rounded"
            >
              <ColorThumb className="w-4 h-4 rounded-full border-3 border-white shadow-[0_0_1px_0_rgba(0,0,0,0.2)] box-border" />
            </ColorArea>

            {/* Hue slider */}
            <ColorSlider colorSpace="hsb" channel="hue" className="w-full">
              <SliderTrack className="w-full h-3 rounded-full">
                <ColorThumb className="w-4 h-4 rounded-full border-3 border-white shadow-[0_0_2px_1px_rgba(0,0,0,0.2)] box-border top-1/2" />
              </SliderTrack>
            </ColorSlider>

            {/* Hex input + eyedropper */}
            <div className="flex items-center gap-1">
              <ColorField
                aria-label="Hex color"
                className="flex items-center gap-1 flex-1 min-w-0"
              >
                <Input className="bg-secondary text-secondary-foreground focus-visible:ring-1 focus-visible:ring-[#0d99ff] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 h-6 rounded-md px-2 py-0.5 text-sm transition-colors aria-invalid:ring-[2px] md:text-xs/relaxed placeholder:text-muted-foreground w-full min-w-0 outline-none" />
              </ColorField>
              {supportsEyeDropper && (
                <button
                  type="button"
                  className="h-6 w-6 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-text-primary cursor-pointer shrink-0"
                  aria-label="Pick color from screen"
                  onClick={async () => {
                    try {
                      const result = await new EyeDropper().open();
                      onChange(result.sRGBHex);
                      setOpen(false);
                    } catch {
                      // User cancelled (Escape) — do nothing
                    }
                  }}
                >
                  <Eyedropper size={14} />
                </button>
              )}
            </div>
          </AriaColorPicker>
        </div>
      , document.body)}
    </div>
  );
}
