import { useStyleStore } from "@/store/styleStore";
import { useHistoryStore } from "@/store/historyStore";
import { useSceneStore } from "@/store/sceneStore";
import { createSnapshot } from "@/store/sceneStore/helpers/history";
import { generateFillStyleId, generateEffectStyleId } from "@/types/style";
import { generateId } from "@/types/scene";
import type { FillStyle, EffectStyle } from "@/types/style";
import type { Effect, Paint } from "@/types/scene";
import type { ToolHandler } from "../toolRegistry";

function normalizeName(name: unknown): string {
  return typeof name === "string" && name.trim() ? name.trim() : "Untitled";
}

type PaintResult = { paint: Paint } | { error: string };

/**
 * Build a `Paint` from a raw tool-call object. Accepts a full `{type, ...}`
 * paint, the `{color}` shorthand for a solid, OR an object that merely carries
 * a `gradient`/`image`/`pattern` sub-object with no explicit `type` — in which
 * case the type is INFERRED from the present shape. Never silently coerces an
 * ambiguous paint to a black solid: an object with no recognizable paint shape
 * returns an error so the caller can report it instead of storing garbage.
 */
export function normalizePaint(obj: Record<string, unknown>): PaintResult {
  const raw = (obj.paint as Record<string, unknown> | undefined) ?? obj;
  const id = typeof raw.id === "string" ? raw.id : generateId();
  const explicitType = typeof raw.type === "string" ? raw.type : undefined;

  // Infer the type from the present shape when not explicitly given.
  const type =
    explicitType ??
    (raw.gradient
      ? "gradient"
      : raw.image
        ? "image"
        : raw.pattern
          ? "pattern"
          : typeof raw.color === "string"
            ? "solid"
            : undefined);

  if (type === "gradient") {
    if (!raw.gradient) return { error: "gradient paint requires a 'gradient' object" };
    return { paint: { id, type: "gradient", gradient: raw.gradient } as unknown as Paint };
  }
  if (type === "image") {
    if (!raw.image) return { error: "image paint requires an 'image' object" };
    return { paint: { id, type: "image", image: raw.image } as unknown as Paint };
  }
  if (type === "pattern") {
    if (!raw.pattern) return { error: "pattern paint requires a 'pattern' object" };
    return { paint: { id, type: "pattern", pattern: raw.pattern } as unknown as Paint };
  }
  if (type === "solid") {
    const color = typeof raw.color === "string" ? raw.color : "#000000";
    return { paint: { id, type: "solid", color } };
  }
  return {
    error:
      "paint shape is ambiguous — provide a 'color' (solid), or a 'gradient'/'image'/'pattern' object (optionally with an explicit 'type')",
  };
}

/** True when the raw object carries any paint-defining field (used to decide whether an update touches the paint). */
function hasPaintInput(obj: Record<string, unknown>): boolean {
  return !!(obj.paint || obj.color || obj.gradient || obj.image || obj.pattern);
}

function normalizeEffects(raw: unknown): Effect[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({ id: generateId(), ...e }) as Effect);
}

interface StyleResult {
  id: string;
  name: string;
  status: "created" | "updated";
}

export const setStyles: ToolHandler = async (args) => {
  const rawFillStyles = args.fillStyles;
  const rawEffectStyles = args.effectStyles;
  const replace = (args.replace as boolean) ?? false;

  if (!Array.isArray(rawFillStyles) && !Array.isArray(rawEffectStyles)) {
    return JSON.stringify({ error: "No fillStyles or effectStyles provided" });
  }

  const fillEntries = (Array.isArray(rawFillStyles) ? rawFillStyles : []).filter(
    (v): v is Record<string, unknown> => !!v && typeof v === "object",
  );
  const effectEntries = (Array.isArray(rawEffectStyles) ? rawEffectStyles : []).filter(
    (v): v is Record<string, unknown> => !!v && typeof v === "object",
  );

  const history = useHistoryStore.getState();
  history.saveHistory(createSnapshot(useSceneStore.getState()));
  history.startBatch();

  const store = useStyleStore.getState();
  const fillResults: StyleResult[] = [];
  const effectResults: StyleResult[] = [];
  const errors: string[] = [];

  if (replace) {
    if (Array.isArray(rawFillStyles)) {
      const built: FillStyle[] = [];
      for (const obj of fillEntries) {
        const paintResult = normalizePaint(obj);
        if ("error" in paintResult) {
          errors.push(`Fill style '${normalizeName(obj.name)}': ${paintResult.error}`);
          continue;
        }
        const style: FillStyle = {
          id: (obj.id as string) || generateFillStyleId(),
          name: normalizeName(obj.name),
          paint: paintResult.paint,
        };
        built.push(style);
        fillResults.push({ id: style.id, name: style.name, status: "created" });
      }
      store.setFillStyles(built);
    }
    if (Array.isArray(rawEffectStyles)) {
      const built = effectEntries.map<EffectStyle>((obj) => {
        const style: EffectStyle = {
          id: (obj.id as string) || generateEffectStyleId(),
          name: normalizeName(obj.name),
          effects: normalizeEffects(obj.effects),
        };
        effectResults.push({ id: style.id, name: style.name, status: "created" });
        return style;
      });
      store.setEffectStyles(built);
    }
  } else {
    const existingFillById = new Map(useStyleStore.getState().fillStyles.map((s) => [s.id, s]));
    const existingFillByName = new Map(useStyleStore.getState().fillStyles.map((s) => [s.name, s]));
    for (const obj of fillEntries) {
      const id = typeof obj.id === "string" ? obj.id : undefined;
      const name = typeof obj.name === "string" ? obj.name.trim() : undefined;
      const match = (id ? existingFillById.get(id) : undefined) ?? (name ? existingFillByName.get(name) : undefined);
      if (match) {
        const updates: Partial<FillStyle> = {};
        if (name) updates.name = name;
        if (hasPaintInput(obj)) {
          const paintResult = normalizePaint(obj);
          if ("error" in paintResult) {
            errors.push(`Fill style '${match.name}': ${paintResult.error}`);
            continue;
          }
          updates.paint = paintResult.paint;
        }
        useStyleStore.getState().updateFillStyle(match.id, updates);
        const updated: FillStyle = { ...match, ...updates };
        existingFillById.set(updated.id, updated);
        if (updated.name !== match.name) existingFillByName.delete(match.name);
        existingFillByName.set(updated.name, updated);
        fillResults.push({ id: match.id, name: updated.name, status: "updated" });
      } else {
        const paintResult = normalizePaint(obj);
        if ("error" in paintResult) {
          errors.push(`Fill style '${normalizeName(obj.name)}': ${paintResult.error}`);
          continue;
        }
        const style: FillStyle = {
          id: (obj.id as string) || generateFillStyleId(),
          name: normalizeName(obj.name),
          paint: paintResult.paint,
        };
        useStyleStore.getState().addFillStyle(style);
        existingFillById.set(style.id, style);
        existingFillByName.set(style.name, style);
        fillResults.push({ id: style.id, name: style.name, status: "created" });
      }
    }

    const existingEffectById = new Map(useStyleStore.getState().effectStyles.map((s) => [s.id, s]));
    const existingEffectByName = new Map(useStyleStore.getState().effectStyles.map((s) => [s.name, s]));
    for (const obj of effectEntries) {
      const id = typeof obj.id === "string" ? obj.id : undefined;
      const name = typeof obj.name === "string" ? obj.name.trim() : undefined;
      const match =
        (id ? existingEffectById.get(id) : undefined) ?? (name ? existingEffectByName.get(name) : undefined);
      if (match) {
        const updates: Partial<EffectStyle> = {};
        if (name) updates.name = name;
        if (obj.effects) updates.effects = normalizeEffects(obj.effects);
        useStyleStore.getState().updateEffectStyle(match.id, updates);
        const updated: EffectStyle = { ...match, ...updates };
        existingEffectById.set(updated.id, updated);
        if (updated.name !== match.name) existingEffectByName.delete(match.name);
        existingEffectByName.set(updated.name, updated);
        effectResults.push({ id: match.id, name: updated.name, status: "updated" });
      } else {
        const style: EffectStyle = {
          id: (obj.id as string) || generateEffectStyleId(),
          name: normalizeName(obj.name),
          effects: normalizeEffects(obj.effects),
        };
        useStyleStore.getState().addEffectStyle(style);
        existingEffectById.set(style.id, style);
        existingEffectByName.set(style.name, style);
        effectResults.push({ id: style.id, name: style.name, status: "created" });
      }
    }
  }

  history.endBatch();

  const finalState = useStyleStore.getState();
  return JSON.stringify({
    success: true,
    fillStyleCount: finalState.fillStyles.length,
    effectStyleCount: finalState.effectStyles.length,
    fillStyles: fillResults,
    effectStyles: effectResults,
    ...(errors.length > 0 ? { errors } : {}),
  });
};
