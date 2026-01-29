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

  useEffect(() => {
    getAvailableFonts()
      .then(setFonts)
      .finally(() => setLoading(false));
  }, []);

  const normalizedValue = value.toLowerCase();
  const filteredFonts = fonts.filter((f) =>
    f.family.toLowerCase().includes(normalizedValue)
  );

  const exactMatch = fonts.some(
    (f) => f.family.toLowerCase() === normalizedValue
  );

  const handleValueChange = (newValue: string) => {
    if (newValue) {
      onChange(newValue);
      setOpen(false);
    }
  };

  const content = (
    <Combobox open={open} onOpenChange={setOpen} value={value}>
      <ComboboxInput
        value={value}
        onValueChange={onChange}
        placeholder={loading ? "Loading fonts..." : "Search fonts..."}
        showTrigger
        showClear
        disabled={loading}
      />
      <ComboboxContent>
        <ComboboxList>
          {filteredFonts.map((font) => (
            <ComboboxItem
              key={font.family}
              value={font.family}
              style={{ fontFamily: font.family }}
              onClick={() => handleValueChange(font.family)}
            >
              {font.family}
            </ComboboxItem>
          ))}
          {value && !exactMatch && (
            <ComboboxItem
              value={value}
              onClick={() => handleValueChange(value)}
            >
              Use &quot;{value}&quot;
            </ComboboxItem>
          )}
          <ComboboxEmpty>Type to enter a custom font name</ComboboxEmpty>
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
