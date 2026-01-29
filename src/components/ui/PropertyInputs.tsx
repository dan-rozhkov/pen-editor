import { useState, useRef, useEffect } from "react";
import type { Variable, ThemeName } from "../../types/variable";
import { getVariableValue } from "../../types/variable";
import { Input } from "./input";
import { Label } from "./label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./input-group";

interface PropertySectionProps {
  title: string;
  children: React.ReactNode;
}

export function PropertySection({ title, children }: PropertySectionProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">
        {title}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

export function PropertyRow({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2">{children}</div>;
}

interface NumberInputProps {
  label?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: NumberInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      onChange(val);
    }
  };

  if (label) {
    return (
      <div className="flex-1">
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <Label className="text-[11px] w-4 shrink-0">{label}</Label>
          </InputGroupAddon>
          <InputGroupInput
            type="number"
            value={Math.round(value * 100) / 100}
            onChange={handleChange}
            min={min}
            max={max}
            step={step}
          />
        </InputGroup>
      </div>
    );
  }

  return (
    <div className="flex-1">
      <Input
        type="number"
        value={Math.round(value * 100) / 100}
        onChange={handleChange}
        min={min}
        max={max}
        step={step}
      />
    </div>
  );
}

interface ColorInputProps {
  value: string;
  onChange: (value: string) => void;
  variableId?: string;
  onVariableChange?: (variableId: string | undefined) => void;
  availableVariables?: Variable[];
  activeTheme?: ThemeName;
}

export function ColorInput({
  value,
  onChange,
  variableId,
  onVariableChange,
  availableVariables = [],
  activeTheme = "light",
}: ColorInputProps) {
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    if (showPicker) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showPicker]);

  // Find bound variable
  const boundVariable = variableId
    ? availableVariables.find((v) => v.id === variableId)
    : undefined;

  // Get display color (from variable or direct value)
  const displayColor = boundVariable
    ? getVariableValue(boundVariable, activeTheme)
    : value || "#000000";

  const handleVariableSelect = (varId: string | undefined) => {
    if (onVariableChange) {
      onVariableChange(varId);
    }
    setShowPicker(false);
  };

  const handleUnbind = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onVariableChange) {
      onVariableChange(undefined);
    }
  };

  // If variable is bound, show variable name with unbind button
  if (boundVariable) {
    return (
      <div className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded border border-border-light"
          style={{ backgroundColor: displayColor }}
        />
        <div className="flex-1 flex items-center gap-1 bg-surface-elevated border border-accent-default rounded px-2 py-1">
          <span className="flex-1 text-xs text-accent-bright truncate">
            {boundVariable.name}
          </span>
          <button
            type="button"
            onClick={handleUnbind}
            className="text-text-muted hover:text-text-primary text-xs"
            title="Unbind variable"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M3 3L9 9M9 3L3 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // Normal mode: color picker + hex input + variable button
  return (
    <div className="flex items-center gap-2 relative" ref={pickerRef}>
      <input
        type="color"
        value={value || "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 rounded border border-border-light cursor-pointer bg-transparent"
      />
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#000000"
        className="flex-1 font-mono"
      />
      {availableVariables.length > 0 && onVariableChange && (
        <button
          type="button"
          onClick={() => setShowPicker(!showPicker)}
          className="p-1.5 rounded border border-border-light hover:border-accent-default bg-surface-elevated text-text-muted hover:text-accent-bright transition-colors"
          title="Bind to variable"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M2 5h10M2 9h10M5 2v10M9 2v10"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}

      {/* Variable Picker Dropdown */}
      {showPicker && availableVariables.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface-default border border-border-light rounded shadow-lg z-50 max-h-40 overflow-y-auto">
          {availableVariables.map((variable) => {
            const varColor = getVariableValue(variable, activeTheme);
            return (
              <button
                key={variable.id}
                type="button"
                onClick={() => handleVariableSelect(variable.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-surface-hover text-left"
              >
                <div
                  className="w-4 h-4 rounded border border-border-light shrink-0"
                  style={{ backgroundColor: varColor }}
                />
                <span className="text-xs text-text-primary truncate">
                  {variable.name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface TextInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function TextInput({
  label,
  value,
  onChange,
  placeholder,
}: TextInputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && <Label className="text-[10px]">{label}</Label>}
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

interface SelectInputProps {
  label?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

export function SelectInput({
  label,
  value,
  options,
  onChange,
}: SelectInputProps) {
  const handleChange = (val: string | null) => {
    if (val !== null) {
      onChange(val);
    }
  };

  if (label) {
    return (
      <div className="flex-1 flex items-center gap-1">
        <Label className="text-[11px] w-12 shrink-0">{label}</Label>
        <Select value={value} onValueChange={handleChange}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className="flex-1">
      <Select value={value} onValueChange={handleChange}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface CheckboxInputProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function CheckboxInput({
  label,
  checked,
  onChange,
}: CheckboxInputProps) {
  return (
    <Label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border border-border-light bg-surface-elevated accent-accent-bright cursor-pointer"
      />
      <span>{label}</span>
    </Label>
  );
}

interface SegmentedControlProps {
  label?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function SegmentedControl({
  label,
  value,
  options,
  onChange,
  disabled,
}: SegmentedControlProps) {
  return (
    <div className="flex items-center gap-1">
      {label && (
        <span className="text-[11px] text-text-muted w-4 shrink-0">
          {label}
        </span>
      )}
      <div className="flex-1 flex border border-border-light rounded overflow-hidden">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`flex-1 px-2 py-1 text-[10px] transition-colors ${
              value === opt.value
                ? "bg-accent-default text-white"
                : "bg-surface-elevated text-text-muted hover:bg-surface-hover"
            } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            onClick={() => !disabled && onChange(opt.value)}
            disabled={disabled}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
