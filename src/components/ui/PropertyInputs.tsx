import React from "react";
import type { Variable, ThemeName } from "../../types/variable";
import { getVariableValue } from "../../types/variable";
import { Input } from "./input";
import { Label } from "./label";
import { SelectWithOptions } from "./select";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./input-group";
import { ButtonGroup } from "./button-group";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./dropdown-menu";
import { FlipHorizontalIcon, FlipVerticalIcon } from "@phosphor-icons/react";
import { CustomColorPicker } from "./ColorPicker";
import { useScrubLabel } from "@/hooks/useScrubLabel";

function formatVariableNameForDisplay(name: string): string {
  return name.trim().replace(/^\$/, "");
}

interface PropertySectionProps {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

export function PropertySection({ title, children, action }: PropertySectionProps) {
  const hasChildren = React.Children.toArray(children).some(Boolean);
  return (
    <div className="relative border-b border-border-default">
      <div className={`flex flex-col gap-2 px-4 pt-3 ${hasChildren ? 'pb-5' : 'pb-3'}`}>
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold text-text-primary">
            {title}
          </div>
          {action}
        </div>
        {hasChildren && <div className="flex flex-col gap-2">{children}</div>}
      </div>
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
  labelOutside?: boolean;
  isMixed?: boolean;
}

export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  labelOutside = false,
  isMixed = false,
}: NumberInputProps) {
  const scrub = useScrubLabel({ value, onChange, step, min, max });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      onChange(val);
    }
  };

  const displayValue = isMixed ? "" : Math.round(value * 100) / 100;
  const mixedProps = isMixed ? { placeholder: "Mixed" } : {};

  if (labelOutside && label) {
    return (
      <div className="flex-1 flex flex-col gap-1">
        <Label className="text-[10px] font-normal" onMouseDown={scrub.onMouseDown} style={scrub.style}>{label}</Label>
        <Input
          type="number"
          value={displayValue}
          onChange={handleChange}
          min={min}
          max={max}
          step={step}
          {...mixedProps}
        />
      </div>
    );
  }

  if (label) {
    return (
      <div className="flex-1">
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <Label className="text-[11px] w-4 shrink-0" onMouseDown={scrub.onMouseDown} style={scrub.style}>{label}</Label>
          </InputGroupAddon>
          <InputGroupInput
            type="number"
            value={displayValue}
            onChange={handleChange}
            min={min}
            max={max}
            step={step}
            {...mixedProps}
          />
        </InputGroup>
      </div>
    );
  }

  return (
    <div className="flex-1">
      <Input
        type="number"
        value={displayValue}
        onChange={handleChange}
        min={min}
        max={max}
        step={step}
        {...mixedProps}
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
  isMixed?: boolean;
}

export function ColorInput({
  value,
  onChange,
  variableId,
  onVariableChange,
  availableVariables = [],
  activeTheme = "light",
  isMixed = false,
}: ColorInputProps) {

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
  };

  const handleUnbind = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onVariableChange) {
      onVariableChange(undefined);
    }
  };

  // If variable is bound, show variable name with unbind button
  if (boundVariable) {
    const variableDisplayName = formatVariableNameForDisplay(boundVariable.name);
    return (
      <div className="flex items-center gap-2">
        <InputGroup className="flex-1">
          <InputGroupAddon align="inline-start">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: displayColor }}
            />
          </InputGroupAddon>
          <span className="flex-1 text-xs text-text-primary truncate px-1.5 py-0.5">
            {variableDisplayName}
          </span>
          <InputGroupAddon align="inline-end">
            <button
              type="button"
              onClick={handleUnbind}
              className="text-text-muted hover:text-text-primary mr-0.5"
              title="Unbind variable"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M3 3L9 9M9 3L3 9"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </InputGroupAddon>
        </InputGroup>
      </div>
    );
  }

  // Mixed mode: show hatched swatch + "Mixed" text
  if (isMixed) {
    return (
      <InputGroup className="flex-1">
        <InputGroupAddon align="inline-start">
          <div
            className="w-4 h-4 rounded border border-border-default"
            style={{
              background:
                "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 8px 8px",
            }}
          />
        </InputGroupAddon>
        <span className="flex-1 text-xs text-text-muted italic px-1.5 py-0.5">Mixed</span>
      </InputGroup>
    );
  }

  // Normal mode: color picker inside input + variable button
  return (
    <div className="flex items-center gap-2">
      <InputGroup className="flex-1">
        <InputGroupAddon align="inline-start">
          <CustomColorPicker value={value || "#000000"} onChange={onChange} />
        </InputGroupAddon>
        <InputGroupInput
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className="font-mono"
        />
      </InputGroup>
      {availableVariables.length > 0 && onVariableChange && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="h-6 w-6 flex items-center justify-center rounded bg-surface-elevated text-text-muted hover:text-text-primary transition-colors"
            title="Bind to variable"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M2 5h10M2 9h10M5 2v10M9 2v10"
                stroke="currentColor"
                strokeWidth="0.8"
                strokeLinecap="round"
              />
            </svg>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom">
            {availableVariables.map((variable) => {
              const varColor = getVariableValue(variable, activeTheme);
              return (
                <DropdownMenuItem
                  key={variable.id}
                  onClick={() => handleVariableSelect(variable.id)}
                >
                  <div
                    className="w-3 h-3 rounded shrink-0"
                    style={{ backgroundColor: varColor }}
                  />
                  {variable.name}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
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
  labelOutside?: boolean;
  isMixed?: boolean;
}

export function SelectInput({
  label,
  value,
  options,
  onChange,
  labelOutside = false,
  isMixed = false,
}: SelectInputProps) {
  const handleChange = (val: string | null) => {
    if (val !== null) {
      onChange(val);
    }
  };

  const selectOptions = isMixed
    ? [{ value: "__mixed__", label: "Mixed" }, ...options]
    : options;
  const selectValue = isMixed ? "__mixed__" : value;

  if (labelOutside && label) {
    return (
      <div className="flex-1 flex flex-col gap-1">
        <Label className="text-[10px] font-normal">{label}</Label>
        <SelectWithOptions
          value={selectValue}
          onValueChange={handleChange}
          options={selectOptions}
          size="sm"
          className="w-full"
        />
      </div>
    );
  }

  if (label) {
    return (
      <div className="flex-1 flex items-center gap-1">
        <Label className="text-[11px] w-12 shrink-0">{label}</Label>
        <SelectWithOptions
          value={selectValue}
          onValueChange={handleChange}
          options={selectOptions}
          size="sm"
          className="w-full"
        />
      </div>
    );
  }

  return (
    <div className="flex-1">
      <SelectWithOptions
        value={selectValue}
        onValueChange={handleChange}
        options={selectOptions}
        size="sm"
        className="w-full"
      />
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
        className="w-4 h-4 rounded bg-surface-elevated accent-accent-bright cursor-pointer"
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
  labelOutside?: boolean;
}

export function SegmentedControl({
  label,
  value,
  options,
  onChange,
  disabled,
  labelOutside = false,
}: SegmentedControlProps) {
  if (labelOutside && label) {
    return (
      <div className="flex-1 flex flex-col gap-1">
        <Label className="text-[10px] font-normal">{label}</Label>
        <div className="flex rounded overflow-hidden">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`flex-1 px-2 py-1 text-[10px] transition-colors ${
                value === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-elevated text-text-muted hover:bg-surface-hover"
              } ${
                disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
              }`}
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

  return (
    <div className="flex items-center gap-1">
      {label && (
        <span className="text-[11px] text-text-muted w-4 shrink-0">
          {label}
        </span>
      )}
      <div className="flex-1 flex rounded overflow-hidden">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`flex-1 px-2 py-1 text-[10px] transition-colors ${
              value === opt.value
                ? "bg-primary text-primary-foreground"
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

interface FlipControlsProps {
  flipX: boolean;
  flipY: boolean;
  onFlipXChange: (value: boolean) => void;
  onFlipYChange: (value: boolean) => void;
}

export function FlipControls({
  flipX,
  flipY,
  onFlipXChange,
  onFlipYChange,
}: FlipControlsProps) {
  return (
    <ButtonGroup orientation="horizontal" className="w-full">
      <Button
        variant="secondary"
        size="sm"
        className="flex-1"
        onClick={() => onFlipXChange(!flipX)}
        title="Flip horizontal"
      >
        <FlipHorizontalIcon />
      </Button>
      <Button
        variant="secondary"
        size="sm"
        className="flex-1"
        onClick={() => onFlipYChange(!flipY)}
        title="Flip vertical"
      >
        <FlipVerticalIcon />
      </Button>
    </ButtonGroup>
  );
}
