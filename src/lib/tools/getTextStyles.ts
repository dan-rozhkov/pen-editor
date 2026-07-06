import { useTextStyleStore } from "@/store/textStyleStore";
import type { ToolHandler } from "../toolRegistry";

export const getTextStyles: ToolHandler = async () => {
  const { textStyles } = useTextStyleStore.getState();

  return JSON.stringify({
    textStyles: textStyles.map((s) => ({
      id: s.id,
      name: s.name,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      textTransform: s.textTransform,
    })),
  });
};
