import { useVariableStore } from "@/store/variableStore";
import { getVariableCssName } from "@/types/variable";
import type { ToolHandler } from "../toolRegistry";

export const getVariables: ToolHandler = async () => {
  const { variables } = useVariableStore.getState();

  return JSON.stringify({
    variables: variables.map((v) => ({
      id: v.id,
      name: v.name,
      type: v.type,
      value: v.value,
      themeValues: v.themeValues,
      // The canonical CSS custom-property name, the same one the editor
      // injects into every embed and the one `canvasContext.variables`
      // carries. `name` is a free-form label ("Color 1" straight out of the
      // Variables panel) and is NOT usable in `var(...)`; the system prompt
      // tells the model to reference `cssName` inside embed HTML, so this
      // tool must report it too or the two channels disagree.
      cssName: getVariableCssName(v),
    })),
  });
};
