import { useVariableStore } from "@/store/variableStore";
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
    })),
  });
};
