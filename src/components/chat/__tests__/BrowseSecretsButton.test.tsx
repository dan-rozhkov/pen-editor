import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowseSecretsButton } from "../BrowseSecretsButton";
import { resetBrowseSecrets, useBrowseSecretStore } from "@/store/browseSecretStore";

beforeEach(() => resetBrowseSecrets());
afterEach(() => cleanup());

function open() {
  render(<BrowseSecretsButton chatId="c1" />);
  fireEvent.click(screen.getByRole("button", { name: "Passwords for the browser" }));
}

describe("BrowseSecretsButton", () => {
  it("adds a secret, shows its placeholder but never the value, and clears the field", async () => {
    open();
    const password = (await screen.findByLabelText("Password")) as HTMLInputElement;
    expect(password.type).toBe("password");
    expect(password.autocomplete).toBe("new-password");
    expect(password.getAttribute("data-1p-ignore")).not.toBeNull();
    expect(password.getAttribute("data-lpignore")).toBe("true");
    expect(password.closest("form")).toBeNull();
    fireEvent.change(password, { target: { value: "hunter22" } });
    fireEvent.keyDown(password, { key: "Enter" });

    expect(useBrowseSecretStore.getState().valuesFor("c1")).toEqual({ password: "hunter22" });
    expect(screen.getByText("{{secret:password}}")).toBeTruthy();
    expect(document.body.textContent).not.toContain("hunter22");
    expect(password.value).toBe("");
    expect(screen.getByTestId("browse-secrets-count").textContent).toBe("1");
  });

  it("flags an illegal name and a short password inline", async () => {
    open();
    const name = (await screen.findByLabelText("Name")) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "bad name" } });
    expect(screen.getByRole("alert").textContent).toContain("Name");

    fireEvent.change(name, { target: { value: "pw" } });
    const password = screen.getByLabelText("Password");
    fireEvent.change(password, { target: { value: "abcde" } });
    fireEvent.keyDown(password, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toContain("at least 6");
    expect(useBrowseSecretStore.getState().namesFor("c1")).toEqual([]);
  });

  it("removes a secret", async () => {
    useBrowseSecretStore.getState().set("c1", "pw", "hunter22");
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Remove pw" }));
    expect(useBrowseSecretStore.getState().namesFor("c1")).toEqual([]);
  });

  it("clears a half-typed password when the popover closes", async () => {
    open();
    const password = (await screen.findByLabelText("Password")) as HTMLInputElement;
    fireEvent.change(password, { target: { value: "half-typed" } });
    fireEvent.keyDown(password, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Password")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Passwords for the browser" }));
    expect(((await screen.findByLabelText("Password")) as HTMLInputElement).value).toBe("");
  });

  it("binds to the chat id it is given", async () => {
    render(<BrowseSecretsButton chatId="c2" />);
    fireEvent.click(screen.getByRole("button", { name: "Passwords for the browser" }));
    const password = await screen.findByLabelText("Password");
    fireEvent.change(password, { target: { value: "hunter22" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(useBrowseSecretStore.getState().namesFor("c2")).toEqual(["password"]);
    expect(useBrowseSecretStore.getState().namesFor("c1")).toEqual([]);
  });
});
