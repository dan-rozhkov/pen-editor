import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CreateLoginForm } from "../CreateLoginDialog";
import { createRowLabel } from "@/lib/docs/savedLogins";

const add = vi.fn();
const list = vi.fn();

beforeEach(() => {
  add.mockReset();
  list.mockReset().mockResolvedValue({ entries: [], encryptionAvailable: true });
  window.penDesktop = { logins: { list, add } } as never;
});
afterEach(() => {
  cleanup();
  window.penDesktop = undefined;
});

function setup(initialUsername = "alice") {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(
    <Dialog open>
      <DialogContent>
        <CreateLoginForm initialUsername={initialUsername} onDone={onDone} onCancel={onCancel} />
      </DialogContent>
    </Dialog>,
  );
  return { onDone, onCancel };
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("CreateLoginForm", () => {
  it("prefills the username from the query", () => {
    setup("alice");
    expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("alice");
  });

  it("requires the site and the password", async () => {
    const { onDone } = setup("");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter the site URL.")).toBeTruthy();
    expect(screen.getByText("Enter the username.")).toBeTruthy();
    expect(screen.getByText("Enter the password.")).toBeTruthy();
    expect(add).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("saves trimmed fields and reports the new login", async () => {
    add.mockResolvedValue({ ok: true, id: "new-1" });
    const { onDone } = setup("");
    type("Site URL", "  https://github.com/login ");
    type("Username", "  alice ");
    type("Password", "s3cret");
    type("Label (optional)", " Work ");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ id: "new-1", username: "alice", host: "github.com" }));
    expect(add).toHaveBeenCalledWith({ site: "https://github.com/login", username: "alice", password: "s3cret", label: "Work" });
  });

  it("leaves the label out when empty", async () => {
    add.mockResolvedValue({ ok: true, id: "n" });
    setup();
    type("Site URL", "github.com");
    type("Password", "p");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(add).toHaveBeenCalled());
    expect(add.mock.calls[0][0]).toEqual({ site: "github.com", username: "alice", password: "p" });
  });

  it("offers Use existing when the login already exists", async () => {
    add.mockResolvedValue({ ok: false, error: "This login is already saved.", exists: true, id: "old-9" });
    const { onDone } = setup();
    type("Site URL", "https://github.com");
    type("Password", "p");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This login is already saved.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use existing" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ id: "old-9", username: "alice", host: "github.com" }));
  });

  it("shows other errors inline without Use existing", async () => {
    add.mockResolvedValue({ ok: false, error: "Encryption is not available." });
    const { onDone } = setup();
    type("Site URL", "https://github.com");
    type("Password", "p");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Encryption is not available.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use existing" })).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("requires the username", async () => {
    setup("");
    type("Site URL", "github.com");
    type("Password", "p");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter the username.")).toBeTruthy();
    expect(add).not.toHaveBeenCalled();
  });

  it("takes the host, port included, from the stored entry", async () => {
    add.mockResolvedValue({ ok: true, id: "n1" });
    list.mockResolvedValue({ entries: [{ id: "n1", origin: "https://app.test:8443", username: "alice", label: "" }], encryptionAvailable: true });
    const { onDone } = setup();
    type("Site URL", "https://www.App.test:8443/x");
    type("Password", "p");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ id: "n1", username: "alice", host: "app.test:8443" }));
  });

  it("stays open and quiet when the desktop confirmation is declined", async () => {
    add.mockResolvedValue({ ok: false, error: "Cancelled." });
    const { onDone } = setup();
    type("Site URL", "https://github.com");
    type("Password", "p");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("reports nothing when it closes while the save is pending", async () => {
    let finish: (value: unknown) => void = () => {};
    add.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const onDone = vi.fn();
    const view = render(
      <Dialog open>
        <DialogContent>
          <CreateLoginForm initialUsername="alice" onDone={onDone} onCancel={() => {}} />
        </DialogContent>
      </Dialog>,
    );
    type("Site URL", "https://github.com");
    type("Password", "p");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(add).toHaveBeenCalled());
    view.unmount();
    finish({ ok: true, id: "late" });
    await new Promise((r) => setTimeout(r, 10));
    expect(onDone).not.toHaveBeenCalled();
  });

  it("disables Cancel and reports busy while the save is pending", async () => {
    let finish: (value: unknown) => void = () => {};
    add.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const onBusy = vi.fn();
    render(
      <Dialog open>
        <DialogContent>
          <CreateLoginForm initialUsername="alice" onDone={() => {}} onCancel={() => {}} onBusy={onBusy} />
        </DialogContent>
      </Dialog>,
    );
    type("Site URL", "https://github.com");
    type("Password", "p");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true));
    expect(onBusy).toHaveBeenLastCalledWith(true);
    finish({ ok: false, error: "Nope" });
    await screen.findByText("Nope");
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false);
    expect(onBusy).toHaveBeenLastCalledWith(false);
  });

  it("cancels", () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("createRowLabel", () => {
  it("names the query when there is one", () => {
    expect(createRowLabel("")).toBe("Create new login");
    expect(createRowLabel(" bob ")).toBe("Create login “bob”");
  });
});
