import { beforeEach, describe, expect, it } from "vitest";
import { useOpenCodeKeyDialogStore } from "@/store/openCodeKeyDialogStore";
import { clearOpenCodeKey, setOpenCodeKey } from "@/lib/opencodeKey";
import { getOpenCodeCommands } from "@/lib/commands/opencodeCommands";

beforeEach(() => {
  useOpenCodeKeyDialogStore.setState({ open: false });
  clearOpenCodeKey();
});

describe("getOpenCodeCommands", () => {
  it("returns a single File-group command, not flagged mutatesScene", () => {
    const commands = getOpenCodeCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].id).toBe("file-connect-opencode");
    expect(commands[0].group).toBe("File");
    expect(commands[0].mutatesScene).toBeUndefined();
  });

  it("labels the command 'Connect OpenCode…' when no key is stored", () => {
    const command = getOpenCodeCommands().find((c) => c.id === "file-connect-opencode");
    expect(command?.label).toBe("Connect OpenCode…");
  });

  it("labels the command 'OpenCode key' once a key is stored", () => {
    setOpenCodeKey("test-key");
    const command = getOpenCodeCommands().find((c) => c.id === "file-connect-opencode");
    expect(command?.label).toBe("OpenCode key");
  });

  it("running the command opens the OpenCode key dialog store", () => {
    const command = getOpenCodeCommands().find((c) => c.id === "file-connect-opencode");
    expect(useOpenCodeKeyDialogStore.getState().open).toBe(false);
    command!.run();
    expect(useOpenCodeKeyDialogStore.getState().open).toBe(true);
  });
});
