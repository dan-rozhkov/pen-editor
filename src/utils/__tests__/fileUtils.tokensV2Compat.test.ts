import { beforeEach, describe, expect, it } from "vitest";
import { deserializeDocument } from "@/utils/fileUtils";
import { applyOpenedDocument } from "@/utils/openDocumentIntoEditor";
import { useVariableStore } from "@/store/variableStore";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores } from "@/test/fixtures";
import { getVariableValue } from "@/types/variable";

// A document as the short-lived "tokens v2" build wrote it: collections, modes,
// aliases and metadata next to the compat mirrors (`value`, `themeValues`).
const v2Document = {
  version: "1.2",
  variableCollections: [
    { id: "theme", name: "Theme", modes: [{ id: "light", name: "Light" }, { id: "dark", name: "Dark" }], defaultModeId: "light" },
  ],
  modeContext: { theme: "dark" },
  variables: [
    {
      id: "v-primary",
      name: "--primary",
      type: "color",
      collectionId: "theme",
      valuesByMode: { light: "#3366ff", dark: { alias: "v-dark" } },
      description: "Brand colour",
      scopes: ["fill"],
      deprecated: { note: "old" },
      value: "#3366ff",
      themeValues: { light: "#3366ff", dark: "#99bbff" },
    },
    { id: "v-radius", name: "--radius", type: "number", collectionId: "theme", valuesByMode: { light: "8", dark: "8" }, value: "8" },
  ],
  pages: [
    {
      id: "p1",
      name: "Page 1",
      nodes: [
        {
          id: "f1",
          type: "frame",
          name: "Dark frame",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          children: [],
          themeOverride: "dark",
          modeOverrides: { theme: "dark" },
          numberBindings: { cornerRadius: { variableId: "v-radius" } },
        },
      ],
    },
  ],
  activeTheme: "dark",
};

beforeEach(() => resetStores());

describe("opening a document saved by the tokens v2 build", () => {
  it("reads the resolved light/dark values and drops the v2-only variable fields", () => {
    const data = deserializeDocument(JSON.stringify(v2Document));
    applyOpenedDocument(data, { viewportWidth: 800, viewportHeight: 600 });

    const [primary, radius] = useVariableStore.getState().variables;
    expect(getVariableValue(primary, "light")).toBe("#3366ff");
    expect(getVariableValue(primary, "dark")).toBe("#99bbff");
    expect(Object.keys(primary).sort()).toEqual(["id", "name", "themeValues", "type", "value"]);
    expect(getVariableValue(radius, "dark")).toBe("8");
    expect(Object.keys(radius).sort()).toEqual(["id", "name", "themeValues", "type", "value"]);
  });

  it("keeps the saved theme and the frame's themeOverride mirror", () => {
    const data = deserializeDocument(JSON.stringify(v2Document));
    expect(data.activeTheme).toBe("dark");
    applyOpenedDocument(data, { viewportWidth: 800, viewportHeight: 600 });
    const frame = useSceneStore.getState().nodesById["f1"] as { themeOverride?: string };
    expect(frame.themeOverride).toBe("dark");
  });

  it("drops the v2-only node fields modeOverrides and numberBindings", () => {
    applyOpenedDocument(deserializeDocument(JSON.stringify(v2Document)), { viewportWidth: 800, viewportHeight: 600 });
    const frame = useSceneStore.getState().nodesById["f1"];
    expect(frame).not.toHaveProperty("modeOverrides");
    expect(frame).not.toHaveProperty("numberBindings");
  });

  it("keeps a numeric value written as a JSON number", () => {
    const doc = { version: "1.1", variables: [{ id: "r", name: "--radius", type: "number", value: 8 }], pages: [] };
    const [radius] = deserializeDocument(JSON.stringify(doc)).variables;
    expect(getVariableValue(radius, "dark")).toBe("8");
  });
});
