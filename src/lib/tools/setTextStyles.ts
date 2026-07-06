import { useTextStyleStore } from "@/store/textStyleStore";
import { generateTextStyleId } from "@/types/textStyle";
import type { TextStyle } from "@/types/textStyle";
import type { ToolHandler } from "../toolRegistry";

function normalizeName(name: unknown): string {
  return typeof name === "string" && name.trim() ? name.trim() : "Untitled";
}

function normalizeTextStyle(obj: Record<string, unknown>): TextStyle {
  const style: TextStyle = {
    id: (obj.id as string) || generateTextStyleId(),
    name: normalizeName(obj.name),
  };
  if (typeof obj.fontFamily === "string") style.fontFamily = obj.fontFamily;
  if (typeof obj.fontSize === "number") style.fontSize = obj.fontSize;
  if (typeof obj.fontWeight === "string") style.fontWeight = obj.fontWeight;
  if (typeof obj.lineHeight === "number") style.lineHeight = obj.lineHeight;
  if (typeof obj.letterSpacing === "number") style.letterSpacing = obj.letterSpacing;
  if (typeof obj.textTransform === "string") {
    style.textTransform = obj.textTransform as TextStyle["textTransform"];
  }
  return style;
}

export const setTextStyles: ToolHandler = async (args) => {
  const incoming = args.textStyles as unknown;
  const replace = (args.replace as boolean) ?? false;

  if (!incoming) {
    return JSON.stringify({ error: "No text styles provided" });
  }

  const rawList: Record<string, unknown>[] = Array.isArray(incoming)
    ? (incoming as Record<string, unknown>[])
    : typeof incoming === "object" && incoming !== null
    ? Object.entries(incoming as Record<string, unknown>).map(([key, val]) => ({
        name: key,
        ...(val as Record<string, unknown>),
      }))
    : [];

  const parsed = rawList
    .filter((v) => v && typeof v === "object")
    .map((v) => normalizeTextStyle(v));

  if (parsed.length === 0) {
    return JSON.stringify({ error: "No valid text styles found in input" });
  }

  const store = useTextStyleStore.getState();

  if (replace) {
    store.setTextStyles(parsed);
  } else {
    const existingById = new Map(store.textStyles.map((s) => [s.id, s]));
    const existingByName = new Map(store.textStyles.map((s) => [s.name, s]));

    for (const style of parsed) {
      const match = existingById.get(style.id) ?? existingByName.get(style.name);
      if (match) {
        // Only copy properties actually present on `style` (conditionally set by
        // normalizeTextStyle) so unspecified fields don't get overwritten with
        // `undefined` when merged onto the existing style.
        const updates: Partial<TextStyle> = { ...style };
        delete updates.id;
        useTextStyleStore.getState().updateTextStyle(match.id, updates);
      } else {
        useTextStyleStore.getState().addTextStyle(style);
      }
    }
  }

  return JSON.stringify({
    success: true,
    textStyleCount: useTextStyleStore.getState().textStyles.length,
  });
};
