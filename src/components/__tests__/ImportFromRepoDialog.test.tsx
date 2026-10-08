import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ImportFromRepoDialog } from "../ImportFromRepoDialog";
import { useVariableStore } from "@/store/variableStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores } from "@/test/fixtures";

const brief = {
  repo: { owner: "acme", name: "app", ref: "main", htmlUrl: "" },
  tokens: {
    colors: { background: "#ffffff", primary: "#111111" },
    dark: { colors: { background: "#000000" } },
    spacing: { "2": "0.5rem" },
    borderRadius: {},
    fontFamily: {},
    boxShadow: { sm: "0 1px 2px #000" },
  },
  notes: [],
};

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("<ImportFromRepoDialog />", () => {
  beforeEach(() => resetStores());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("reads a repo, previews the counts and imports in one undo step", async () => {
    const fetchFn = mockFetch(200, brief);
    const onOpenChange = vi.fn();
    render(<ImportFromRepoDialog open onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "acme/app" } });
    fireEvent.click(screen.getByRole("button", { name: "Read tokens" }));

    await screen.findByLabelText("Tokens to import");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/repo/brief");
    expect(JSON.parse(init.body as string)).toEqual({ repo: "acme/app" });
    expect(screen.getByText("Theme aliases").nextSibling?.textContent).toBe("2");
    expect(screen.getByText(/boxShadow: 1 shadow/)).toBeTruthy();
    expect(useVariableStore.getState().variables).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    const names = useVariableStore.getState().variables.map((v) => v.name).sort();
    expect(names).toEqual(["--background", "--color-background", "--color-background-dark", "--color-primary", "--primary", "--space-2"]);
    expect(useHistoryStore.getState().past).toHaveLength(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows a backend error and imports nothing", async () => {
    mockFetch(404, { error: "Repository not found" });
    render(<ImportFromRepoDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "no/such" } });
    fireEvent.click(screen.getByRole("button", { name: "Read tokens" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Repository not found"));
    expect(useVariableStore.getState().variables).toHaveLength(0);
  });
});
