import type { InspectUnits } from "@/store/devModeStore";
import type { MeasureLine } from "@/store/measureStore";

/**
 * Strip trailing zeros and decimal point if necessary.
 * E.g. "1.2000" → "1.2", "1.0000" → "1", "2.50" → "2.5"
 */
export function stripTrailingZeros(num: string): string {
  return num.replace(/\.?0+$/, "");
}

/**
 * Format a pixel length to a string in the specified units.
 *
 * @param px - The length in pixels
 * @param units - The target units ("px" or "rem")
 * @param remBase - The rem base in pixels (default 16)
 * @returns Formatted string, e.g. "16px" or "1rem"
 *
 * Examples:
 * - formatLength(16, "px", 16) === "16px"
 * - formatLength(16, "rem", 16) === "1rem"
 * - formatLength(10, "rem", 16) === "0.625rem" (10/16 = 0.625)
 * - formatLength(10.5, "px", 16) === "10.5px"
 */
export function formatLength(
  px: number,
  units: InspectUnits,
  remBase: number
): string {
  let value: number;
  let suffix: string;
  let decimals: number;

  if (units === "px") {
    value = px;
    suffix = "px";
    decimals = 2;
  } else {
    // Convert px to rem
    value = px / remBase;
    suffix = "rem";
    decimals = 4;
  }

  // Format with appropriate decimal places, then strip trailing zeros
  const str = value.toFixed(decimals);
  return stripTrailingZeros(str) + suffix;
}

/**
 * Format a measure line by rebuilding its label with the appropriate unit formatting.
 * Returns a shallow copy of the line with the label re-derived from Math.abs(line.length).
 *
 * @param line - The original measure line
 * @param units - The target units ("px" or "rem")
 * @param remBase - The rem base in pixels
 * @returns A new MeasureLine with the updated label
 */
export function formatMeasureLine(
  line: MeasureLine,
  units: InspectUnits,
  remBase: number
): MeasureLine {
  const label = formatLength(Math.abs(line.length), units, remBase);
  return {
    orientation: line.orientation,
    x: line.x,
    y: line.y,
    length: line.length,
    label,
  };
}
