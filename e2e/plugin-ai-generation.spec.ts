import { test, expect } from "@playwright/test";
import { stubModels, stubChatTurns, openAgentsRail, sendChatMessage } from "./support/api";

// Smoke test for AI plugin generation (plg-03): the backend is stubbed via
// page.route the same way chat-smoke.spec.ts stubs it, but this time the
// streamed tool call is `create_plugin`. Verifies the full loop: streamed
// tool call -> local pluginStore.install() -> command-palette entry ->
// running the installed plugin in a real sandboxed iframe (plg-01 runtime)
// actually does what its code says.

const PLUGIN_NAME = "SmokeTestPlugin";
const PLUGIN_CODE = `
  await pen.scene.batch('f=I(document, {type: "frame", name: "PluginCreatedFrame", x: 0, y: 0, width: 100, height: 80})');
  pen.notify("plugin ran");
  pen.close();
`;

const FIRST_TURN_TEXT = "Installing your plugin now.";
const FINAL_TURN_TEXT = "The plugin has been installed. Smoke test complete.";

test("AI chat streams a create_plugin tool call, installs it, and it runs from the command palette", async ({
  page,
}) => {
  await stubModels(page);

  const chatRequests = await stubChatTurns(page, [
    [
      { type: "start" },
      { type: "start-step" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: FIRST_TURN_TEXT },
      { type: "text-end", id: "t1" },
      {
        type: "tool-input-available",
        toolCallId: "call-plugin-1",
        toolName: "create_plugin",
        input: {
          name: PLUGIN_NAME,
          description: "Creates a frame and closes.",
          code: PLUGIN_CODE,
          ui: null,
        },
      },
      { type: "finish-step" },
      { type: "finish" },
    ],
    [
      { type: "start" },
      { type: "start-step" },
      { type: "text-start", id: "t2" },
      { type: "text-delta", id: "t2", delta: FINAL_TURN_TEXT },
      { type: "text-end", id: "t2" },
      { type: "finish-step" },
      { type: "finish" },
    ],
  ]);

  await page.goto("/app");

  await openAgentsRail(page);
  await expect(page.getByText("Design Agent", { exact: true })).toBeVisible();

  await sendChatMessage(page, "Make me a plugin that inserts a frame");

  await expect(page.getByText(FIRST_TURN_TEXT)).toBeVisible();
  await expect(page.getByText(FINAL_TURN_TEXT)).toBeVisible({ timeout: 15_000 });
  expect(chatRequests).toHaveLength(2);

  // The tool result carried by the auto-continuation confirms install.
  const assistant = chatRequests[1].messages?.find((m) => m.role === "assistant");
  const toolPart = assistant?.parts.find((p) => p.type === "tool-create_plugin");
  expect(toolPart).toBeTruthy();
  expect(toolPart!.state).toBe("output-available");
  expect(String(toolPart!.output)).toContain("plugin installed");
  expect(String(toolPart!.output)).toContain(PLUGIN_NAME);

  // The plugin actually landed in pluginStore (exposed on window in dev mode).
  const pluginId = await page.evaluate((name) => {
    const w = window as unknown as {
      __pluginStore: { getState: () => { plugins: Array<{ id: string; name: string }> } };
    };
    return w.__pluginStore.getState().plugins.find((p) => p.name === name)?.id ?? null;
  }, PLUGIN_NAME);
  expect(pluginId).toBeTruthy();

  // It shows up as a command-palette entry.
  const paletteCommandExists = await page.evaluate(
    ({ id, name }) => {
      const w = window as unknown as {
        __getCommands: () => Array<{ id: string; label: string }>;
      };
      return w.__getCommands().some((c) => c.id === `plugin-${id}` && c.label === name);
    },
    { id: pluginId, name: PLUGIN_NAME }
  );
  expect(paletteCommandExists).toBe(true);

  // Running it (as the palette would) actually executes the installed code:
  // it mutates the scene and closes itself.
  await page.evaluate((id) => {
    const w = window as unknown as {
      __getCommands: () => Array<{ id: string; run: () => void }>;
    };
    w.__getCommands().find((c) => c.id === `plugin-${id}`)?.run();
  }, pluginId);

  await page.waitForFunction(() => {
    const store = (
      window as unknown as {
        __sceneStore: { getState: () => { nodesById: Record<string, { name?: string }> } };
      }
    ).__sceneStore;
    return Object.values(store.getState().nodesById).some(
      (n) => n.name === "PluginCreatedFrame"
    );
  });

  // pen.close() tore the sandboxed iframe down.
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
});
