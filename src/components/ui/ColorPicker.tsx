import { useState, useRef, useEffect, useCallback } from "react";
import {
  ColorPicker as AriaColorPicker,
  ColorArea,
  ColorThumb,
  ColorSlider,
  SliderTrack,
  ColorField,
  Input as AriaInput,
  parseColor,
  type Color,
} from "react-aria-components";

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
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const sizeClass = swatchSize === "sm" ? "w-5 h-5" : "w-8 h-8";

  return (
    <div className="relative" ref={containerRef}>
      {/* Swatch trigger */}
      <button
        type="button"
        className={`${sizeClass} rounded cursor-pointer shrink-0 border border-border-light`}
        style={{ backgroundColor: safeValue }}
        onClick={() => setOpen(!open)}
        aria-label="Pick color"
      />

      {/* Popover */}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-surface-panel border border-border-light rounded-lg shadow-lg p-3 flex flex-col gap-2 w-[200px]">
          <AriaColorPicker value={color} onChange={handleChange}>
            {/* Saturation / Brightness area */}
            <ColorArea
              colorSpace="hsb"
              xChannel="saturation"
              yChannel="brightness"
              aria-label="Color"
              className="w-full h-[140px] rounded"
            >
              <ColorThumb className="w-4 h-4 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)] box-border" />
            </ColorArea>

            {/* Hue slider */}
            <ColorSlider colorSpace="hsb" channel="hue" className="w-full">
              <SliderTrack className="w-full h-3 rounded-full">
                <ColorThumb className="w-4 h-4 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)] box-border top-1/2" />
              </SliderTrack>
            </ColorSlider>

            {/* Hex input */}
            <ColorField aria-label="Hex color" className="flex items-center gap-1">
              <span className="text-[10px] text-text-muted">#</span>
              <AriaInput className="flex-1 bg-surface-elevated border border-border-light rounded px-2 py-1 text-xs text-text-primary font-mono outline-none focus:border-accent-bright" />
            </ColorField>
          </AriaColorPicker>
        </div>
      )}
    </div>
  );
}
