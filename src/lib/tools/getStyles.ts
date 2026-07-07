import { useStyleStore } from "@/store/styleStore";
import type { ToolHandler } from "../toolRegistry";

/** Read all named fill/effect styles defined in the .pen file. */
export const getStyles: ToolHandler = async () => {
  const { fillStyles, effectStyles } = useStyleStore.getState();

  return JSON.stringify({
    fillStyles: fillStyles.map((s) => ({ id: s.id, name: s.name, paint: s.paint })),
    effectStyles: effectStyles.map((s) => ({ id: s.id, name: s.name, effects: s.effects })),
  });
};
