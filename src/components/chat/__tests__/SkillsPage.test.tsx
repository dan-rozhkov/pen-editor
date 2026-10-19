import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { useUserSkillStore } from "@/store/userSkillStore";
import { SkillsPage } from "../SkillsPage";

vi.mock("@/lib/userId", () => ({
  getUserId: () => "test-user-id",
}));

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

function skill(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: "my-skill",
    description: "Handles renaming layers",
    body: "Always rename layers sequentially.",
    enabled: true,
    source: "manual" as const,
    useCount: 0,
    updatedAt: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
let onClose: Mock<() => void>;

beforeEach(() => {
  onClose = vi.fn<() => void>();
  // Default: any unconfigured fetch call fails cleanly (ok:false) rather
  // than returning `undefined`, which would throw deep inside requestJson.
  // Individual tests override with mockResolvedValueOnce/mockImplementation
  // as needed. This matters now that ensureHydrated() retries on every call
  // while status is "error" (see defect 1), so a panel mounted already in
  // an error state fires an extra hydrate attempt on mount.
  fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "unconfigured fetch" }, { ok: false, status: 500 }));
  vi.stubGlobal("fetch", fetchMock);
  useUserSkillStore.setState({
    skills: [],
    builtIn: [{ name: "prototype", description: "Build a clickable prototype" }],
    available: true,
    status: "ready",
    error: null,
    pendingUpdates: {},
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<SkillsPage />", () => {
  it("lists built-in skills as read-only", () => {
    render(<SkillsPage onClose={onClose} />);
    expect(screen.getByText("/prototype")).toBeTruthy();
    expect(screen.getByText("Build a clickable prototype")).toBeTruthy();
  });

  it("shows an empty state when the user has no skills yet", () => {
    render(<SkillsPage onClose={onClose} />);
    expect(screen.getByTestId("skills-empty-state-icon")).toBeTruthy();
    expect(screen.getByText(/No skills yet/)).toBeTruthy();
  });

  it("lists the user's own skills with name and description", () => {
    useUserSkillStore.setState({ skills: [skill()], status: "ready" });
    render(<SkillsPage onClose={onClose} />);
    expect(screen.getByText("/my-skill")).toBeTruthy();
    expect(screen.getByText("Handles renaming layers")).toBeTruthy();
  });

  it("explains that skill sync needs the backend when available is false", () => {
    useUserSkillStore.setState({ available: false, status: "ready" });
    render(<SkillsPage onClose={onClose} />);
    expect(screen.getByText(/needs the backend/)).toBeTruthy();
  });

  it("shows a distinct, recoverable error (not the 'not configured' message) when the fetch failed", () => {
    useUserSkillStore.setState({ available: false, status: "error", error: "db unreachable" });
    render(<SkillsPage onClose={onClose} />);
    expect(screen.getByText(/Couldn't load your skills/)).toBeTruthy();
    expect(screen.getByText(/db unreachable/)).toBeTruthy();
    expect(screen.queryByText(/needs the backend/)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("Retry calls refresh() and recovers from the error state", async () => {
    useUserSkillStore.setState({ available: false, status: "error", error: "db unreachable" });
    render(<SkillsPage onClose={onClose} />);

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/user-skills")) {
        return jsonResponse({ skills: [skill()], available: true });
      }
      return jsonResponse({ skills: [] });
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("/my-skill")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("uploading a .md file prefills the create form from its frontmatter", async () => {
    render(<SkillsPage onClose={onClose} />);

    const file = new File(
      ["---\nname: contrast-check\ndescription: Flags low contrast text\n---\n\nAlways check contrast."],
      "contrast-check.md",
      { type: "text/markdown" },
    );
    fireEvent.change(screen.getByLabelText("Upload skill file"), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("contrast-check"),
    );
    expect((screen.getByLabelText("Description") as HTMLInputElement).value).toBe(
      "Flags low contrast text",
    );
    expect((screen.getByLabelText("Instructions") as HTMLTextAreaElement).value).toBe(
      "Always check contrast.",
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ skill: skill({ name: "contrast-check", description: "Flags low contrast text" }) }, { status: 201 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("/contrast-check")).toBeTruthy());
  });

  it("surfaces a client-side validation error and does not hit the network", async () => {
    render(<SkillsPage onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "New skill" }));

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Not Valid!" } });
    fireEvent.change(screen.getByLabelText("Instructions"), { target: { value: "do things" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(/lowercase letter and contain only lowercase letters/),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the store's error when a save fails on the backend", async () => {
    render(<SkillsPage onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "New skill" }));

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "dup-skill" } });
    fireEvent.change(screen.getByLabelText("Instructions"), { target: { value: "do things" } });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "A skill named dup-skill already exists." }, { ok: false, status: 409 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("A skill named dup-skill already exists.")).toBeTruthy();
  });

  it("toggles a skill's enabled state", async () => {
    useUserSkillStore.setState({ skills: [skill()], status: "ready" });
    render(<SkillsPage onClose={onClose} />);

    fetchMock.mockResolvedValueOnce(jsonResponse({ skill: skill({ enabled: false }) }));
    fireEvent.click(screen.getByRole("switch", { name: "Disable my-skill" }));

    await waitFor(() => expect(useUserSkillStore.getState().skills[0].enabled).toBe(false));
    expect(screen.getByText("Disabled")).toBeTruthy();
  });

  it("shows an inline error when a dropped file isn't a .md file", () => {
    render(<SkillsPage onClose={onClose} />);

    const file = new File(["console.log('hi')"], "notes.txt", { type: "text/plain" });
    const dataTransfer = { files: [file] } as unknown as DataTransfer;
    fireEvent.drop(screen.getByText(/No skills yet/), { dataTransfer });

    expect(screen.getByText(/Drop a \.md file/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disables a skill's row controls while its update is in flight", async () => {
    useUserSkillStore.setState({ skills: [skill()], status: "ready" });
    render(<SkillsPage onClose={onClose} />);

    let resolveFetch: (r: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const toggle = screen.getByRole("switch", { name: "Disable my-skill" }) as HTMLButtonElement;
    fireEvent.click(toggle);

    await waitFor(() => expect(toggle.disabled).toBe(true));
    expect((screen.getByRole("button", { name: "Skill options" }) as HTMLButtonElement).disabled).toBe(true);

    resolveFetch!(jsonResponse({ skill: skill({ enabled: false }) }));
    await waitFor(() => expect(toggle.disabled).toBe(false));
  });

  it("deletes a skill after confirmation", async () => {
    useUserSkillStore.setState({ skills: [skill()], status: "ready" });
    render(<SkillsPage onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Skill options" }));
    fireEvent.click(screen.getByText("Delete"));
    // Not deleted yet — still awaiting confirmation.
    expect(useUserSkillStore.getState().skills).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(jsonResponse({ deleted: true }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(useUserSkillStore.getState().skills).toHaveLength(0));
  });

  it("the header back button closes the page", () => {
    render(<SkillsPage onClose={onClose} />);
    fireEvent.click(screen.getByTestId("skills-page-back"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking a user skill row opens its edit form, and the form's back button returns to the list without closing", () => {
    useUserSkillStore.setState({ skills: [skill()], status: "ready" });
    render(<SkillsPage onClose={onClose} />);

    fireEvent.click(screen.getByTestId("user-skill-open-my-skill"));
    expect(screen.getByText("Edit skill")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("my-skill");

    fireEvent.click(screen.getByTestId("skills-page-back"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.getByText("/my-skill")).toBeTruthy();
  });

  it("moves focus to the back button on mount", () => {
    render(<SkillsPage onClose={onClose} />);
    expect(document.activeElement).toBe(screen.getByTestId("skills-page-back"));
  });

  it("Escape acts like Back: sub-view returns to the list, list closes", () => {
    render(<SkillsPage onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "New skill" }));
    expect(screen.getByText("New skill")).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId("skills-page"), { key: "Escape" });
    expect(screen.getByText("Skills")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId("skills-page-back"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape that was already handled", () => {
    render(<SkillsPage onClose={onClose} />);
    const back = screen.getByTestId("skills-page-back");
    back.addEventListener("keydown", (e) => e.preventDefault());
    fireEvent.keyDown(back, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not jump to the form if the user left the generate view meanwhile", async () => {
    let resolveFetch!: (r: Response) => void;
    fetchMock.mockImplementation(
      () => new Promise<Response>((r) => (resolveFetch = r)),
    );
    render(<SkillsPage onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate with the agent" }));
    fireEvent.change(screen.getByLabelText("What should this skill do?"), {
      target: { value: "check contrast" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Skills")).toBeTruthy();
    resolveFetch(
      jsonResponse({ draft: { name: "contrast", description: "d", body: "b" } }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByLabelText("Instructions")).toBeNull();
    expect(screen.getByText("Skills")).toBeTruthy();
  });
});
