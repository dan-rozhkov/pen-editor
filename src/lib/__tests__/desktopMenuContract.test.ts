import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { resetStores } from "@/test/fixtures";
import { getCommands } from "@/lib/commands/registry";

/**
 * Cross-repo contract: the Electron shell's native menu (pen-editor-desktop
 * src/main/menu.ts) forwards **command-palette ids** over IPC `menu:command`,
 * and src/lib/desktopBridge.ts dispatches them through getCommands(). Renaming
 * or removing one of these ids here silently breaks a desktop menu item —
 * there is no runtime error, the bridge just console.warns in a shell nobody
 * is watching.
 *
 * Two halves, mirroring toolContract.test.ts:
 *  - the pinned list below always runs, so a rename fails in this repo's
 *    normal test job even when the sibling checkout is absent;
 *  - when ../pen-editor-desktop exists, the ids are read out of the real menu
 *    template, so an id typed only on the desktop side fails too.
 *
 * Keep this list, pen-editor/CLAUDE.md ("Desktop shell bridge") and
 * pen-editor-desktop/CLAUDE.md ("Cross-repo contract") in sync.
 */
const MENU_FORWARDED_COMMAND_IDS = [
  "file-open",
  "file-export-pen",
  "file-export-json",
  "file-export-tokens",
  "file-import-tokens",
];

beforeEach(() => {
  resetStores();
});

describe("desktop menu command contract", () => {
  it("every id the desktop menu forwards exists in the command registry", () => {
    const ids = new Set(getCommands().map((command) => command.id));
    const missing = MENU_FORWARDED_COMMAND_IDS.filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
  });

  it("every forwarded command is runnable", () => {
    const commands = getCommands();
    for (const id of MENU_FORWARDED_COMMAND_IDS) {
      const command = commands.find((c) => c.id === id);
      expect(typeof command?.run, id).toBe("function");
    }
  });
});

// Vitest runs with cwd = pen-editor/, the sibling desktop repo lives next to it.
const desktopMenuPath = resolve(
  process.cwd(),
  "../pen-editor-desktop/src/main/menu.ts"
);
const desktopExists = existsSync(desktopMenuPath);

// In the cross-repo CI job the sibling checkout is mandatory — a missing
// desktop repo must fail the job, not silently skip the contract.
if (process.env.CONTRACT_REQUIRE_DESKTOP && !desktopExists) {
  throw new Error(
    `CONTRACT_REQUIRE_DESKTOP is set but ${desktopMenuPath} does not exist`
  );
}

/**
 * Walks the real menu template with recording actions and returns every id
 * passed to forwardToActiveTab. menu.ts imports only a *type* from electron,
 * so it loads here without electron installed.
 */
async function collectForwardedIds(): Promise<string[]> {
  const mod = (await import(/* @vite-ignore */ desktopMenuPath)) as {
    buildMenuTemplate: (
      actions: Record<string, (commandId?: string) => void>,
      opts: { isMac: boolean }
    ) => MenuTemplateItem[];
  };
  const forwarded: string[] = [];
  // Only forwardToActiveTab is part of this contract; every other action is
  // shell-local (tabs, MCP ownership). clickAll() invokes every handler, so a
  // plain object would make this repo's CI red each time the shell grows a
  // menu item it never forwards. A no-op proxy keeps the contract to the ids.
  // A rename of forwardToActiveTab still fails loudly: nothing gets recorded.
  const actions = new Proxy(
    {
      forwardToActiveTab: (commandId?: string) => {
        forwarded.push(commandId as string);
      },
    } as Record<string, (commandId?: string) => void>,
    {
      get: (target, prop: string) => target[prop] ?? (() => {}),
    }
  );
  clickAll(mod.buildMenuTemplate(actions, { isMac: true }));
  return forwarded;
}

interface MenuTemplateItem {
  submenu?: MenuTemplateItem[];
  click?: (...args: unknown[]) => void;
}

function clickAll(items: MenuTemplateItem[]): void {
  for (const item of items) {
    // Electron calls click(menuItem, browserWindow, event); the shell's
    // handlers ignore all three, so calling bare is faithful enough.
    item.click?.();
    if (Array.isArray(item.submenu)) clickAll(item.submenu);
  }
}

describe.runIf(desktopExists)("desktop menu template sync", () => {
  it("forwards exactly the pinned id set", async () => {
    const forwarded = await collectForwardedIds();
    expect([...new Set(forwarded)].sort()).toEqual(
      [...MENU_FORWARDED_COMMAND_IDS].sort()
    );
  });

  it("every id in the real menu template resolves to a command", async () => {
    const forwarded = await collectForwardedIds();
    const ids = new Set(getCommands().map((command) => command.id));
    expect(forwarded.filter((id) => !ids.has(id))).toEqual([]);
  });
});

describe.runIf(!desktopExists)("desktop menu template sync (skipped)", () => {
  it.skip("pen-editor-desktop not found next to pen-editor", () => {});
});
