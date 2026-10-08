import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
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

  it("ignores a late response after the dialog was closed", async () => {
    let release: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    const { rerender } = render(<ImportFromRepoDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "acme/app" } });
    fireEvent.click(screen.getByRole("button", { name: "Read tokens" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    rerender(<ImportFromRepoDialog open onOpenChange={() => {}} />);
    await act(async () => {
      release(new Response(JSON.stringify(brief), { status: 200 }));
    });
    expect(screen.queryByLabelText("Tokens to import")).toBeNull();
  });

  it("asks for a second confirm when the variables changed after the preview", async () => {
    mockFetch(200, brief);
    render(<ImportFromRepoDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "acme/app" } });
    fireEvent.click(screen.getByRole("button", { name: "Read tokens" }));
    await screen.findByLabelText("Tokens to import");
    // A local variable appears that the import would now overwrite.
    useVariableStore.setState({
      collections: [
        ...useVariableStore.getState().collections,
        { id: "prim", name: "Primitives", modes: [{ id: "default", name: "Default" }], defaultModeId: "default" },
      ],
      variables: [{ id: "x", name: "--space-2", type: "number", collectionId: "prim", valuesByMode: { default: "1" }, value: "1" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.getByText(/changed since this preview/)).toBeTruthy();
    expect(useVariableStore.getState().variables).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(useVariableStore.getState().variables.length).toBeGreaterThan(1);
  });

  it("shows plain-language errors with a Retry", async () => {
    mockFetch(500, {});
    render(<ImportFromRepoDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "acme/app" } });
    fireEvent.click(screen.getByRole("button", { name: "Read tokens" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("could not read the repository"));
    expect(screen.getByRole("alert").textContent).not.toContain("read_design_repo");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
