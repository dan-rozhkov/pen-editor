import {
  useState,
  useCallback,
  type FocusEvent,
} from "react";
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
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const supportsEyeDropper = typeof window !== "undefined" && "EyeDropper" in window;

type ColorFormat = "hex" | "rgb" | "hsl";

const FORMAT_OPTIONS: { value: ColorFormat; label: string }[] = [
  { value: "hex", label: "HEX" },
  { value: "rgb", label: "RGB" },
  { value: "hsl", label: "HSL" },
];

// The per-channel numeric inputs shown in RGB / HSL mode. `as const` keeps the
// `colorSpace`/`channel` literals assignable to react-aria's ColorSpace /
// ColorChannel prop types without importing them.
const CHANNEL_CONFIG = {
  rgb: [
    { colorSpace: "rgb", channel: "red", label: "Red" },
    { colorSpace: "rgb", channel: "green", label: "Green" },
    { colorSpace: "rgb", channel: "blue", label: "Blue" },
  ],
  hsl: [
    { colorSpace: "hsl", channel: "hue", label: "Hue" },
    { colorSpace: "hsl", channel: "saturation", label: "Saturation" },
    { colorSpace: "hsl", channel: "lightness", label: "Lightness" },
  ],
} as const;

const INPUT_CLASS_BASE =
  "bg-secondary text-secondary-foreground focus-visible:ring-1 focus-visible:ring-accent-light aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 h-6 rounded-md py-0.5 text-sm transition-colors aria-invalid:ring-[2px] md:text-xs/relaxed placeholder:text-muted-foreground w-full min-w-0 outline-none";
const HEX_INPUT_CLASS = `${INPUT_CLASS_BASE} px-2`;
const CHANNEL_INPUT_CLASS = `${INPUT_CLASS_BASE} px-1 text-center`;
const FORMAT_TOGGLE_GROUP_CLASS =
  "h-6 rounded-md bg-secondary gap-px [&>[data-slot]]:rounded-[5px]! [&>[data-slot]]:border [&>[data-slot]~[data-slot]]:border-l";
const FORMAT_TOGGLE_BUTTON_CLASS =
  "flex-1 h-full border-transparent bg-transparent text-text-muted hover:bg-surface-elevated hover:text-text-primary";
const ACTIVE_FORMAT_TOGGLE_BUTTON_CLASS =
  "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel";

function retainChannelInputFocus(event: FocusEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  requestAnimationFrame(() => {
    if (input.isConnected && document.activeElement !== input) {
      input.focus();
    }
  });
}

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
  const [format, setFormat] = useState<ColorFormat>("hex");

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

  const sizeClass = swatchSize === "sm" ? "w-3 h-3" : "w-4 h-4";

  return (
    <div className="relative flex cursor-default">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
        className={`${sizeClass} rounded-sm cursor-pointer shrink-0`}
        style={{ backgroundColor: safeValue }}
        aria-label="Pick color"
        />

        <PopoverContent
          side="left"
          sideOffset={20}
          className="w-[200px]"
          initialFocus={false}
          draggable
          dragHandleContent={<span className="text-[11px] font-semibold text-text-primary">Color</span>}
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
            <ColorSlider
              colorSpace="hsb"
              channel="hue"
              aria-label="Hue slider"
              className="w-full"
            >
              <SliderTrack className="w-full h-3 rounded-full">
                <ColorThumb className="w-4 h-4 rounded-full border-3 border-white shadow-[0_0_2px_1px_rgba(0,0,0,0.2)] box-border top-1/2" />
              </SliderTrack>
            </ColorSlider>

            {/* Keep the picker format controls in the same ButtonGroup used by
                the properties panel; a dropdown would escape this popover. */}
            <ButtonGroup orientation="horizontal" className={`w-full ${FORMAT_TOGGLE_GROUP_CLASS}`}>
              {FORMAT_OPTIONS.map((option) => {
                const isActive = format === option.value;
                return (
                  <Button
                    key={option.value}
                    variant="ghost"
                    size="sm"
                    className={`${FORMAT_TOGGLE_BUTTON_CLASS} ${
                      isActive ? ACTIVE_FORMAT_TOGGLE_BUTTON_CLASS : ""
                    }`}
                    aria-pressed={isActive}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => setFormat(option.value)}
                  >
                    {option.label}
                  </Button>
                );
              })}
            </ButtonGroup>

            {/* Input row + eyedropper */}
            <div className="flex items-center gap-1">
              {format === "hex" ? (
                <ColorField
                  aria-label="Hex color"
                  className="flex items-center gap-1 flex-1 min-w-0"
                >
                  <Input className={HEX_INPUT_CLASS} />
                </ColorField>
              ) : (
                <div className="flex items-center gap-1 flex-1 min-w-0">
                  {CHANNEL_CONFIG[format].map(({ colorSpace, channel, label }) => (
                    <ColorField
                      key={channel}
                      colorSpace={colorSpace}
                      channel={channel}
                      aria-label={label}
                      className="min-w-0 flex-1"
                    >
                      <Input
                        className={CHANNEL_INPUT_CLASS}
                        onFocus={retainChannelInputFocus}
                      />
                    </ColorField>
                  ))}
                </div>
              )}
              {supportsEyeDropper && (
                <button
                  type="button"
                  className="h-6 w-6 flex items-center justify-center rounded-md text-text-secondary hover:bg-secondary hover:text-text-primary cursor-pointer shrink-0"
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
        </PopoverContent>
      </Popover>
    </div>
  );
}
