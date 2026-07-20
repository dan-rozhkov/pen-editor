import { useStyleStore } from "@/store/styleStore";
import type { ToolHandler } from "../toolRegistry";
import { applyStyleToNodes } from "./applyStyleToNodes";

/** Bind one or more nodes' effect stack (shadows/blur) to a named effect style. */
export const applyEffectStyle: ToolHandler = async (args) => {
  const store = useStyleStore.getState();
  return applyStyleToNodes(
    args,
    "Effect style",
    (styleId) => store.effectStyles.find((s) => s.id === styleId),
    (nodeId, styleId) => store.applyEffectStyleToNode(nodeId, styleId),
  );
};
