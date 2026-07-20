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
