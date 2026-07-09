import { useState, useEffect, useMemo, useRef } from "react";
import { TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "./combobox";
import {
  getAvailableFonts,
  loadGoogleFont,
  isGoogleFont,
  mergeCustomFontsIntoList,
  type SystemFont,
} from "@/utils/fontUtils";
import { useCustomFontStore } from "@/store/customFontStore";
import { Label } from "./label";
import { InputGroup, InputGroupAddon } from "./input-group";

const UPLOAD_FONT_ITEM_VALUE = "__upload_custom_font__";

interface FontComboboxProps {
  label?: string;
  value: string;
  onChange: (font: string) => void;
}

export function FontCombobox({ label, value, onChange }: FontComboboxProps) {
  const [fonts, setFonts] = useState<SystemFont[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const inputGroupRef = useRef<HTMLDivElement>(null);
  const fontFileInputRef = useRef<HTMLInputElement>(null);

  const customFonts = useCustomFontStore((s) => s.customFonts);
  const addCustomFont = useCustomFontStore((s) => s.addCustomFont);
  const removeCustomFont = useCustomFontStore((s) => s.removeCustomFont);

  useEffect(() => {
    getAvailableFonts()
      .then(setFonts)
      .finally(() => setLoading(false));
  }, []);

  const customFamilies = useMemo(() => customFonts.map((f) => f.family), [customFonts]);
  const allFonts = useMemo(
    () => mergeCustomFontsIntoList(fonts, customFamilies),
    [fonts, customFamilies],
  );

  // Force background on input group
  useEffect(() => {
    const applyStyles = () => {
      if (inputGroupRef.current) {
        const inputGroup = inputGroupRef.current.querySelector(
          '[data-slot="input-group"]',
        ) as HTMLElement;
        if (inputGroup) {
          inputGroup.style.setProperty(
            "background-color",
            "var(--color-surface-panel)",
            "important",
          );
          inputGroup.style.setProperty(
            "border",
            "1px solid var(--color-input)",
            "important",
          );
          inputGroup.style.setProperty(
            "border-radius",
            "0.375rem",
            "important",
          );
        }
      }
    };

    // Apply immediately and after a short delay to catch late-rendered elements
    applyStyles();
    const timeoutId = setTimeout(applyStyles, 0);
    return () => clearTimeout(timeoutId);
  });

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen) {
      setSearchValue("");
    }
  };

  const normalizedSearch = searchValue.toLowerCase();
  const filteredFonts =
    normalizedSearch === ""
      ? allFonts
      : allFonts.filter((f) => f.family.toLowerCase().includes(normalizedSearch));

  const exactMatch = allFonts.some(
    (f) => f.family.toLowerCase() === normalizedSearch,
  );

  const customItems = filteredFonts.filter((f) => f.isCustomFont);
  const otherItems = filteredFonts.filter((f) => !f.isCustomFont);

  const handleSelectFont = (font: string) => {
    if (isGoogleFont(font)) {
      loadGoogleFont(font);
    }
    onChange(font);
    setSearchValue("");
    setOpen(false);
  };

  const handleUploadClick = () => {
    fontFileInputRef.current?.click();
  };

  const handleFontFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset immediately so re-selecting the same file later still fires onChange.
    e.target.value = "";
    if (!file) return;
    const family = await addCustomFont(file);
    if (family) {
      handleSelectFont(family);
    }
  };

  const handleRemoveCustomFontPointerDown = (e: React.PointerEvent) => {
    // Stop base-ui's Combobox.Item from treating this as a selection press.
    e.stopPropagation();
  };

  const handleRemoveCustomFontClick = (e: React.MouseEvent, family: string) => {
    e.stopPropagation();
    e.preventDefault();
    removeCustomFont(family);
  };

  const content = (
    <Combobox open={open} onOpenChange={handleOpenChange} value={value}>
      <div ref={inputGroupRef}>
        <ComboboxInput
          className="[&_[data-slot=input-group]]:border [&_[data-slot=input-group]]:border-input [&_[data-slot=input-group]]:rounded-md [&_[data-slot=input-group]]:focus-within:border-ring [&_[data-slot=input-group]]:focus-within:ring-ring/30 [&_[data-slot=input-group]]:focus-within:ring-[2px] [&_[data-slot=input-group]]:!bg-surface-panel"
          value={open ? searchValue : value}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder={loading ? "Loading fonts..." : "Search fonts..."}
          showTrigger
          showClear={open}
          disabled={loading}
        />
      </div>
      <ComboboxContent>
        <ComboboxList>
          <ComboboxItem value={UPLOAD_FONT_ITEM_VALUE} onClick={handleUploadClick}>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <UploadSimpleIcon className="size-3.5" />
              Upload font…
            </span>
          </ComboboxItem>
          {customItems.length > 0 && (
            <>
              <div className="px-2 pt-1.5 pb-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                Custom
              </div>
              {customItems.map((font) => (
                <ComboboxItem
                  key={font.family}
                  value={font.family}
                  onClick={() => handleSelectFont(font.family)}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate">{font.family}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${font.family}`}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onPointerDown={handleRemoveCustomFontPointerDown}
                    onClick={(e) => handleRemoveCustomFontClick(e, font.family)}
                  >
                    <TrashIcon className="size-3.5" />
                  </button>
                </ComboboxItem>
              ))}
            </>
          )}
          {otherItems.map((font) => (
            <ComboboxItem
              key={font.family}
              value={font.family}
              onClick={() => handleSelectFont(font.family)}
            >
              <span className="flex items-center gap-1.5">
                {font.family}
                {font.isGoogleFont && (
                  <span className="text-[9px] text-muted-foreground opacity-60">G</span>
                )}
              </span>
            </ComboboxItem>
          ))}
          {searchValue && !exactMatch && (
            <ComboboxItem
              value={searchValue}
              onClick={() => handleSelectFont(searchValue)}
            >
              Use &quot;{searchValue}&quot;
            </ComboboxItem>
          )}
          <ComboboxEmpty>Type to search or enter custom font</ComboboxEmpty>
        </ComboboxList>
      </ComboboxContent>
      <input
        ref={fontFileInputRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        className="hidden"
        onChange={handleFontFileChange}
      />
    </Combobox>
  );

  if (label) {
    return (
      <div className="flex-1">
        <InputGroup
          className="border border-input rounded-md focus-within:border-ring focus-within:ring-ring/30 focus-within:ring-[2px]"
          style={{ backgroundColor: "var(--color-surface-panel)" }}
        >
          <InputGroupAddon align="inline-start">
            <Label className="text-[11px] w-4 shrink-0">{label}</Label>
          </InputGroupAddon>
          {content}
        </InputGroup>
      </div>
    );
  }

  return <div className="flex-1">{content}</div>;
}
