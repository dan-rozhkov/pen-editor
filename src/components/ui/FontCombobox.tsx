import { useState, useEffect, useRef } from "react";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "./combobox";
import { getAvailableFonts, loadGoogleFont, isGoogleFont, type SystemFont } from "@/utils/fontUtils";
import { Label } from "./label";
import { InputGroup, InputGroupAddon } from "./input-group";

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

  useEffect(() => {
    getAvailableFonts()
      .then(setFonts)
      .finally(() => setLoading(false));
  }, []);

  // Force white background on input group
  useEffect(() => {
    const applyStyles = () => {
      if (inputGroupRef.current) {
        const inputGroup = inputGroupRef.current.querySelector(
          '[data-slot="input-group"]',
        ) as HTMLElement;
        if (inputGroup) {
          inputGroup.style.setProperty(
            "background-color",
            "white",
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
      ? fonts
      : fonts.filter((f) => f.family.toLowerCase().includes(normalizedSearch));

  const exactMatch = fonts.some(
    (f) => f.family.toLowerCase() === normalizedSearch,
  );

  const handleSelectFont = (font: string) => {
    if (isGoogleFont(font)) {
      loadGoogleFont(font);
    }
    onChange(font);
    setSearchValue("");
    setOpen(false);
  };

  const content = (
    <Combobox open={open} onOpenChange={handleOpenChange} value={value}>
      <div ref={inputGroupRef}>
        <ComboboxInput
          className="[&_[data-slot=input-group]]:border [&_[data-slot=input-group]]:border-input [&_[data-slot=input-group]]:rounded-md [&_[data-slot=input-group]]:focus-within:border-ring [&_[data-slot=input-group]]:focus-within:ring-ring/30 [&_[data-slot=input-group]]:focus-within:ring-[2px] [&_[data-slot=input-group]]:!bg-white"
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
          {filteredFonts.map((font) => (
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
    </Combobox>
  );

  if (label) {
    return (
      <div className="flex-1">
        <InputGroup
          className="border border-input rounded-md focus-within:border-ring focus-within:ring-ring/30 focus-within:ring-[2px]"
          style={{ backgroundColor: "white" }}
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
