import { expect, test } from "@playwright/test";

test("overview culls nested detail and restores it after zooming in", async ({ page }) => {
  await page.route("**/api/models", (route) =>
    route.fulfill({ json: { models: [], default: null } }),
  );
  await page.goto("/");
  await expect(page.locator("[data-canvas]")).toBeVisible();

  await page.evaluate(() => {
    const w = window as unknown as {
      __sceneStore: { setState: (state: unknown) => void };
      __viewportStore: {
        getState: () => {
          setViewportState: (state: { scale: number; x: number; y: number }) => void;
        };
      };
    };
    const root = {
      id: "overview-root",
      type: "frame",
      name: "Overview root",
      x: 0,
      y: 0,
      width: 50_000,
      height: 2_000,
      fill: "#ffffff",
      effects: [
        {
          type: "shadow",
          shadowType: "outer",
          color: "#00000040",
          offset: { x: 0, y: 8 },
          blur: 16,
          spread: 0,
        },
        { type: "blur", radius: 4 },
      ],
    };
    const tinyText = {
      id: "overview-tiny-text",
      type: "text",
      name: "Tiny detail",
      x: 100,
      y: 100,
      width: 160,
      height: 20,
      text: "Tiny detail",
      fontSize: 16,
      fill: "#111111",
    };
    const distant = {
      id: "overview-distant",
      type: "rect",
      name: "Distant detail",
      x: 30_000,
      y: 100,
      width: 200,
      height: 200,
      fill: "#ff0000",
    };
    w.__sceneStore.setState({
      nodesById: {
        [root.id]: root,
        [tinyText.id]: tinyText,
        [distant.id]: distant,
      },
      parentById: {
        [root.id]: null,
        [tinyText.id]: root.id,
        [distant.id]: root.id,
      },
      childrenById: {
        [root.id]: [tinyText.id, distant.id],
        [tinyText.id]: [],
        [distant.id]: [],
      },
      rootIds: [root.id],
      _cachedTree: null,
    });
    w.__viewportStore.getState().setViewportState({ scale: 0.1, x: 0, y: 0 });
  });

  const readRenderability = () =>
    page.evaluate(() => {
      const refs = (
        window as unknown as {
          __canvasRefStore: {
            getState: () => { pixiRefs: { sceneRoot: import("pixi.js").Container } | null };
          };
        }
      ).__canvasRefStore.getState().pixiRefs;
      if (!refs) return null;
      const root = refs.sceneRoot.getChildByLabel("overview-root", true);
      const tinyText = refs.sceneRoot.getChildByLabel("overview-tiny-text", true);
      const distant = refs.sceneRoot.getChildByLabel("overview-distant", true);
      const shadow = root?.getChildByLabel("shadow-layer");
      const layerBlur = (root?.filters ?? []).find(
        (filter) => (filter as typeof filter & { __layerBlur?: true }).__layerBlur,
      );
      return {
        tinyText: tinyText?.renderable,
        distant: distant?.renderable,
        shadow: shadow?.renderable,
        layerBlur: layerBlur?.enabled,
      };
    });

  await expect.poll(readRenderability).toEqual({
    tinyText: false,
    distant: false,
    shadow: false,
    layerBlur: false,
  });

  await page.evaluate(() => {
    (
      window as unknown as {
        __viewportStore: {
          getState: () => {
            setViewportState: (state: { scale: number; x: number; y: number }) => void;
          };
        };
      }
    ).__viewportStore.getState().setViewportState({ scale: 1, x: 0, y: 0 });
  });

  await expect.poll(readRenderability).toEqual({
    tinyText: true,
    distant: false,
    shadow: true,
    layerBlur: true,
  });
});
