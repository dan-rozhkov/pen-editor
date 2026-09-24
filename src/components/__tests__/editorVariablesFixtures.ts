import { useVariableStore } from "@/store/variableStore";
import type { EmbedNode } from "@/types/scene";
import type { Variable } from "@/types/variable";

// Shared F5-regression fixture for EmbedSlideThumbnail.editorVariables.test.tsx
// and InlineEmbedEditor.editorVariables.test.tsx — both mount the same embed
// node into their own shadow tree and check editor variable resolution there.

export function seedVariable(): void {
  useVariableStore.setState({
    variables: [
      {
        id: "v1",
        name: "--brand",
        type: "color",
        value: "#00ff00",
        themeValues: { light: "#00ff00", dark: "#003300" },
      } as unknown as Variable,
    ],
  });
}

export const editorVariablesEmbedNode = {
  id: "e1",
  type: "embed",
  name: "Code",
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  htmlContent: "<div id='card' style='background-color: var(--brand)'>hi</div>",
} as unknown as EmbedNode;
