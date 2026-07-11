import { useTextStyleStore } from "@/store/textStyleStore";
import { useHistoryStore, withHistoryBatch } from "@/store/historyStore";
import { useSceneStore } from "@/store/sceneStore";
import { createSnapshot } from "@/store/sceneStore/helpers/history";
import { generateTextStyleId, pickTextStyleProperties } from "@/types/textStyle";
import type { TextStyle } from "@/types/textStyle";
import type { ToolHandler } from "../toolRegistry";

function normalizeName(name: unknown): string {
  return typeof name === "string" && name.trim() ? name.trim() : "Untitled";
}

/** Build a brand-new style (creation path): id/name default when absent, typography fields
 * picked from `TEXT_STYLE_PROPERTY_KEYS` and validated (see `pickTextStyleProperties`). */
function createTextStyle(obj: Record<string, unknown>): TextStyle {
  return {
    id: (obj.id as string) || generateTextStyleId(),
    name: normalizeName(obj.name),
    ...pickTextStyleProperties(obj),
  };
}

/**
 * Build a partial update (merge path): only the fields the caller actually supplied are
 * included. In particular `name` is only set when present — a partial-by-id update like
 * `{ id: "x", fontSize: 48 }` must not clobber the existing style's name with a default.
 */
function buildTextStyleUpdate(obj: Record<string, unknown>): Partial<TextStyle> {
  const updates: Partial<TextStyle> = pickTextStyleProperties(obj);
  if (typeof obj.name === "string" && obj.name.trim()) {
    updates.name = obj.name.trim();
  }
  return updates;
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

  const rawEntries = rawList.filter((v) => v && typeof v === "object");

  if (rawEntries.length === 0) {
    return JSON.stringify({ error: "No valid text styles found in input" });
  }

  if (replace) {
    useTextStyleStore.getState().setTextStyles(rawEntries.map(createTextStyle));
    return JSON.stringify({
      success: true,
      textStyleCount: useTextStyleStore.getState().textStyles.length,
    });
  }

  // One tool call = one undo step, even when it adds/updates several styles:
  // snapshot once up front, then batch every per-item store call below (their
  // own internal saveHistory calls are suppressed while batched — see
  // historyStore's reference-counted startBatch/endBatch).
  const history = useHistoryStore.getState();
  history.saveHistory(createSnapshot(useSceneStore.getState()));

  withHistoryBatch(() => {
    // Kept live (updated as we go) rather than snapshotted once before the
    // loop, so a later entry in the same call can match a style just
    // added/renamed by an earlier entry instead of creating a duplicate.
    const existingById = new Map(useTextStyleStore.getState().textStyles.map((s) => [s.id, s]));
    const existingByName = new Map(useTextStyleStore.getState().textStyles.map((s) => [s.name, s]));

    for (const obj of rawEntries) {
      const id = typeof obj.id === "string" ? obj.id : undefined;
      const name = typeof obj.name === "string" ? obj.name.trim() : undefined;
      const match = (id ? existingById.get(id) : undefined) ?? (name ? existingByName.get(name) : undefined);

      if (match) {
        const updates = buildTextStyleUpdate(obj);
        useTextStyleStore.getState().updateTextStyle(match.id, updates);
        const updated: TextStyle = { ...match, ...updates };
        existingById.set(updated.id, updated);
        if (updated.name !== match.name) existingByName.delete(match.name);
        existingByName.set(updated.name, updated);
      } else {
        const style = createTextStyle(obj);
        useTextStyleStore.getState().addTextStyle(style);
        existingById.set(style.id, style);
        existingByName.set(style.name, style);
      }
    }
  });

  return JSON.stringify({
    success: true,
    textStyleCount: useTextStyleStore.getState().textStyles.length,
  });
};
