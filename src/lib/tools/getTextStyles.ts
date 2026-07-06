import { useTextStyleStore } from "@/store/textStyleStore";
import { TEXT_STYLE_PROPERTY_KEYS } from "@/types/textStyle";
import type { ToolHandler } from "../toolRegistry";

export const getTextStyles: ToolHandler = async () => {
  const { textStyles } = useTextStyleStore.getState();

  return JSON.stringify({
    textStyles: textStyles.map((s) => {
      const serialized: Record<string, unknown> = { id: s.id, name: s.name };
      for (const key of TEXT_STYLE_PROPERTY_KEYS) serialized[key] = s[key];
      return serialized;
    }),
  });
};
