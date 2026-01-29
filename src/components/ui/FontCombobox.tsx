import { useState, useEffect } from "react";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "./combobox";
import { getAvailableFonts, type SystemFont } from "@/utils/fontUtils";
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

  useEffect(() => {
    getAvailableFonts()
      .then(setFonts)
      .finally(() => setLoading(false));
  }, []);

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
    onChange(font);
    setSearchValue("");
    setOpen(false);
  };

  const content = (
    <Combobox open={open} onOpenChange={handleOpenChange} value={value}>
      <ComboboxInput
        value={open ? searchValue : value}
        onChange={(e) => setSearchValue(e.target.value)}
        placeholder={loading ? "Loading fonts..." : "Search fonts..."}
        showTrigger
        showClear={open}
        disabled={loading}
      />
      <ComboboxContent>
        <ComboboxList>
          {filteredFonts.map((font) => (
            <ComboboxItem
              key={font.family}
              value={font.family}
              style={{ fontFamily: font.family }}
              onClick={() => handleSelectFont(font.family)}
            >
              {font.family}
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
        <InputGroup>
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
