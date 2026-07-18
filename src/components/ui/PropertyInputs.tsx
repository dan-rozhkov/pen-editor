import React, { useEffect, useRef, useState } from "react";
import type { Variable, ThemeName } from "../../types/variable";
import { getVariableValue } from "../../types/variable";
import { Input } from "./input";
import { Label } from "./label";
import { SelectWithOptions } from "./select";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./input-group";
import { ButtonGroup } from "./button-group";
import { IconButton } from "./IconButton";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./dropdown-menu";
import { FlipHorizontalIcon, FlipVerticalIcon, IconContext } from "@phosphor-icons/react";
import { CustomColorPicker } from "./ColorPicker";
import { useScrubLabel } from "@/hooks/useScrubLabel";
import { useReadOnly } from "@/hooks/useReadOnly";
import { useHistoryStore } from "@/store/historyStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { cn } from "@/lib/utils";

function formatVariableNameForDisplay(name: string): string {
  return name.trim().replace(/^\$/, "");
}

function formatHexForDisplay(value: string): string {
  return /^#[\da-f]{0,8}$/i.test(value) ? value.toUpperCase() : value;
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
      <div className={cn("flex flex-col gap-2 px-4 pt-3", hasChildren ? "pb-5" : "pb-3")}>
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
  icon?: React.ReactNode;
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
  icon,
}: NumberInputProps) {
  const readOnly = useReadOnly();
  const scrub = useScrubLabel({ value, onChange, step, min, max });

  // This is a visual editor: every keystroke commits to the store so the canvas
  // tracks typing live. The draft is only a text buffer for the field itself —
  // it keeps intermediate strings that parseFloat can't use ("", "-", "1.")
  // on screen instead of snapping the input back to the last good number.
  const [draft, setDraft] = useState<string | null>(null);
  // An editing session (focus → blur) is one undo step, same shape as a scrub
  // drag: snapshot + startBatch at the first real commit, endBatch at the end.
  // Starting lazily keeps focus-and-leave out of history entirely.
  const sessionOpenRef = useRef(false);

  // Escape is handled by a window keydown listener registered with
  // { capture: true } (useCanvasKeyboardShortcuts): it clears the selection,
  // which unmounts this input before its own keydown/blur handlers can run.
  // Without this cleanup the batch outlives the component and batchDepth
  // stays above 0, silently killing history recording for the whole session.
  useEffect(
    () => () => {
      if (!sessionOpenRef.current) return;
      useHistoryStore.getState().endBatch();
      sessionOpenRef.current = false;
    },
    [],
  );

  const formattedValue = isMixed ? "" : String(Math.round(value * 100) / 100);
  const displayValue = draft ?? formattedValue;
  const mixedProps = isMixed ? { placeholder: "Mixed" } : {};

  const beginSession = () => {
    if (sessionOpenRef.current) return;
    const history = useHistoryStore.getState();
    sessionOpenRef.current = true;
    history.saveHistory(createSnapshot(useSceneStore.getState()));
    history.startBatch();
  };

  const endSession = () => {
    if (!sessionOpenRef.current) return;
    useHistoryStore.getState().endBatch();
    sessionOpenRef.current = false;
  };

  const commitValue = (raw: string) => {
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed)) return;
    let next = parsed;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    // In a mixed selection the displayed `value` is only the first node's, so
    // "unchanged vs value" says nothing about the other nodes — always commit.
    if (!isMixed && next === value) return;
    beginSession();
    onChange(next);
  };

  const handleFocus = () => {
    if (readOnly) return;
    setDraft(isMixed ? "" : formattedValue);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (readOnly) return;
    setDraft(e.target.value);
    commitValue(e.target.value);
  };

  const handleBlur = () => {
    endSession();
    setDraft(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (readOnly) return;
    if (e.key === "Enter") {
      commitValue(e.currentTarget.value);
      // Close the session here rather than leaning on the blur below: Enter
      // means "done editing" on its own, and blur only fires if the field
      // actually held focus. handleBlur's endSession() is idempotent.
      endSession();
      setDraft(null);
      e.currentTarget.blur();
    }
  };

  const inputProps = {
    type: "number" as const,
    value: displayValue,
    onFocus: handleFocus,
    onChange: handleChange,
    onBlur: handleBlur,
    onKeyDown: handleKeyDown,
    readOnly,
    min,
    max,
    step,
    ...mixedProps,
  };

  const scrubMouseDown = readOnly ? undefined : scrub.onMouseDown;

  if (labelOutside && label) {
    return (
      <div className="flex-1 flex flex-col gap-1">
        <Label className="text-[10px] font-normal" onMouseDown={scrubMouseDown} style={scrub.style}>{label}</Label>
        {icon ? (
          <InputGroup>
            <InputGroupAddon align="inline-start">
              {icon}
            </InputGroupAddon>
            <InputGroupInput {...inputProps} />
          </InputGroup>
        ) : (
          <Input {...inputProps} />
        )}
      </div>
    );
  }

  if (label) {
    return (
      <div className="flex-1">
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <Label className="text-[11px] w-4 shrink-0" onMouseDown={scrubMouseDown} style={scrub.style}>{label}</Label>
          </InputGroupAddon>
          <InputGroupInput {...inputProps} />
        </InputGroup>
      </div>
    );
  }

  if (icon) {
    return (
      <div className="flex-1">
        <InputGroup>
          <InputGroupAddon align="inline-start">
            {icon}
          </InputGroupAddon>
          <InputGroupInput {...inputProps} />
        </InputGroup>
      </div>
    );
  }

  return (
    <div className="flex-1">
      <Input {...inputProps} />
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
  const readOnly = useReadOnly();

  // Find bound variable
  const boundVariable = variableId
    ? availableVariables.find((v) => v.id === variableId)
    : undefined;

  // Get display color (from variable or direct value)
  const displayColor = boundVariable
    ? getVariableValue(boundVariable, activeTheme)
    : value || "#000000";

  const handleVariableSelect = (varId: string | undefined) => {
    if (readOnly) return;
    if (onVariableChange) {
      onVariableChange(varId);
    }
  };

  const handleUnbind = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (readOnly) return;
    if (onVariableChange) {
      onVariableChange(undefined);
    }
  };

  // If variable is bound, show variable name with unbind button
  if (boundVariable) {
    const variableDisplayName = formatVariableNameForDisplay(boundVariable.name);
    return (
      <div className="flex min-w-0 items-center gap-2">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon align="inline-start">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: displayColor }}
            />
          </InputGroupAddon>
          <span className="min-w-0 flex-1 truncate px-1.5 py-0.5 text-xs text-text-primary">
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
          <CustomColorPicker
            value={value || "#000000"}
            onChange={(c) => !readOnly && onChange(c)}
          />
        </InputGroupAddon>
        <InputGroupInput
          type="text"
          value={formatHexForDisplay(value)}
          onChange={(e) => !readOnly && onChange(e.target.value)}
          readOnly={readOnly}
          placeholder="#000000"
        />
      </InputGroup>
      {availableVariables.length > 0 && onVariableChange && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="h-6 w-6 flex items-center justify-center rounded bg-secondary text-text-muted hover:text-text-primary transition-colors"
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
  const readOnly = useReadOnly();
  return (
    <div className="flex flex-col gap-1">
      {label && <Label className="text-[10px]">{label}</Label>}
      <Input
        type="text"
        value={value}
        onChange={(e) => !readOnly && onChange(e.target.value)}
        readOnly={readOnly}
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
  prefix?: React.ReactNode;
  labelOutside?: boolean;
  labelClassName?: string;
  isMixed?: boolean;
}

export function SelectInput({
  label,
  value,
  options,
  onChange,
  prefix,
  labelOutside = false,
  labelClassName,
  isMixed = false,
}: SelectInputProps) {
  const readOnly = useReadOnly();
  const handleChange = (val: string | null) => {
    if (readOnly) return;
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
        <Label className={cn("text-[10px] font-normal", labelClassName)}>{label}</Label>
        <SelectWithOptions
          value={selectValue}
          onValueChange={handleChange}
          options={selectOptions}
          triggerPrefix={prefix}
          size="sm"
          className="w-full"
        />
      </div>
    );
  }

  if (label) {
    return (
      <div className="flex-1 flex items-center gap-1">
        <Label className={cn("text-[11px] w-12 shrink-0", labelClassName)}>{label}</Label>
        <SelectWithOptions
          value={selectValue}
          onValueChange={handleChange}
          options={selectOptions}
          triggerPrefix={prefix}
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
        triggerPrefix={prefix}
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
  const readOnly = useReadOnly();
  return (
    <Label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => !readOnly && onChange(e.target.checked)}
        disabled={readOnly}
        className="w-4 h-4 rounded bg-secondary accent-accent-bright cursor-pointer"
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
  disabled: disabledProp,
  labelOutside = false,
}: SegmentedControlProps) {
  const readOnly = useReadOnly();
  const disabled = disabledProp || readOnly;
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
                  : "bg-secondary text-text-muted hover:bg-secondary"
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
                : "bg-secondary text-text-muted hover:bg-secondary"
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
  const readOnly = useReadOnly();
  return (
    <IconContext.Provider value={{ weight: "light" }}>
      <ButtonGroup orientation="horizontal" className="w-full">
        <IconButton
          variant="secondary"
          size="sm"
          className="flex-1"
          onClick={() => onFlipXChange(!flipX)}
          disabled={readOnly}
          tooltip="Flip horizontal"
          title="Flip horizontal"
        >
          <FlipHorizontalIcon className="size-[18px]!" />
        </IconButton>
        <IconButton
          variant="secondary"
          size="sm"
          className="flex-1"
          onClick={() => onFlipYChange(!flipY)}
          disabled={readOnly}
          tooltip="Flip vertical"
          title="Flip vertical"
        >
          <FlipVerticalIcon className="size-[18px]!" />
        </IconButton>
      </ButtonGroup>
    </IconContext.Provider>
  );
}
