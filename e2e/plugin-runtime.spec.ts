import { test, expect } from "@playwright/test";

// Smoke test for the plugin runtime (plg-01): runs a real plugin in a real
// sandboxed iframe (no mocking of postMessage/RPC) and verifies it can
// mutate the scene graph via pen.scene.batch and tear itself down via
// pen.close(). Mirrors chat-smoke.spec.ts's goto/readiness/__sceneStore
// access patterns and its batch_design op-string DSL.

const BATCH_OPERATIONS =
  'f=I(document, {type: "frame", name: "E2EPluginFrame", x: 0, y: 0, width: 120, height: 80})';

test("a plugin running in a real sandboxed iframe creates a node via pen.scene.batch", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() =>
    Boolean((window as unknown as Record<string, unknown>).__pluginHost)
  );

  await page.evaluate((operations) => {
    const host = (
      window as unknown as {
        __pluginHost: { runPlugin: (p: unknown) => unknown };
      }
    ).__pluginHost;
    host.runPlugin({
      id: "e2e-plugin",
      name: "E2E",
      description: "",
      source: "ai",
      createdAt: 0,
      updatedAt: 0,
      code: `
        await pen.scene.batch(${JSON.stringify(operations)});
        pen.notify("plugin done");
        pen.close();
      `,
    });
  }, BATCH_OPERATIONS);

  await page.waitForFunction(() => {
    const store = (
      window as unknown as {
        __sceneStore: {
          getState: () => { nodesById: Record<string, { name?: string }> };
        };
      }
    ).__sceneStore;
    return Object.values(store.getState().nodesById).some(
      (n) => n.name === "E2EPluginFrame"
    );
  });

  // pen.close() must have torn the iframe down.
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
});

// Covers plg-04's DoD item 1: a UI plugin (`ui` set) opens a floating panel
// whose iframe hosts real plugin-authored DOM; clicking a button inside it
// calls pen.tools.run and mutates the scene, same as the headless path above.
const UI_BATCH_OPERATIONS =
  'f=I(document, {type: "frame", name: "E2EPluginUIFrame", x: 200, y: 200, width: 60, height: 40})';

test("a UI plugin opens a panel; clicking its button mutates the scene via pen.tools.run", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() =>
    Boolean((window as unknown as Record<string, unknown>).__pluginHost)
  );

  await page.evaluate((operations) => {
    const host = (
      window as unknown as {
        __pluginHost: { runPlugin: (p: unknown) => unknown };
      }
    ).__pluginHost;
    host.runPlugin({
      id: "e2e-ui-plugin",
      name: "E2E UI",
      description: "",
      source: "ai",
      createdAt: 0,
      updatedAt: 0,
      ui: { width: 300, height: 200 },
      code: `
        const btn = document.createElement("button");
        btn.textContent = "Run";
        btn.addEventListener("click", () => {
          void pen.tools.run("batch_design", { operations: ${JSON.stringify(operations)} });
        });
        document.body.appendChild(btn);
      `,
    });
  }, UI_BATCH_OPERATIONS);

  // The panel titlebar (host-rendered, not inside the sandboxed iframe).
  await expect(page.getByText("E2E UI")).toBeVisible();

  const pluginFrame = page.frameLocator('iframe[sandbox="allow-scripts"]');
  await pluginFrame.getByRole("button", { name: "Run" }).click();

  await page.waitForFunction(() => {
    const store = (
      window as unknown as {
        __sceneStore: {
          getState: () => { nodesById: Record<string, { name?: string }> };
        };
      }
    ).__sceneStore;
    return Object.values(store.getState().nodesById).some(
      (n) => n.name === "E2EPluginUIFrame"
    );
  });

  // Closing the panel tears the instance down (teardown path, DoD item 4).
  // Exact match: the chat UI elsewhere on the page has an (unrelated)
  // "Close tab" button whose accessible name also contains "Close".
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
});
