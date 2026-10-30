import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkflowPage from "@/routes/WorkflowPage";
import { LocationProbe } from "@/test/LocationProbe";
import { resetDesktopWorkflowMirrorForTests, startDesktopWorkflowMirror } from "@/lib/workflows/desktopWorkflowMirror";
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  listWorkflows,
  stepsFromTexts,
  updateWorkflow,
} from "@/lib/workflows/workflowStore";

const SAVED = { timeout: 1500 };

function renderWorkflow(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <WorkflowPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function seed(title: string, texts: string[]) {
  return createWorkflow({ title, steps: stepsFromTexts(texts) }, "editor");
}

/** Opens a seeded workflow page. */
function openSeeded(texts: string[], title = "Launch") {
  const workflow = seed(title, texts);
  renderWorkflow(`/workflow?id=${workflow.id}`);
  return workflow;
}

const storedTexts = (id: string) => getWorkflow(id)?.steps.map((s) => s.text);
const stepField = (n: number) => screen.getByLabelText(`Step ${n}`) as HTMLTextAreaElement;
const clickLabel = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("WorkflowPage", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("shows the empty state without workflows and creates one from it", async () => {
    renderWorkflow("/workflow?chat=off");
    expect(screen.getByText("No workflows yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /New workflow/ }));
    const [meta] = listWorkflows();
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain(`id=${meta.id}`));
    expect(screen.getByTestId("location").textContent).toContain("chat=off");
    expect(stepField(1).value).toBe("");
  });

  it("shows neither the empty state nor a create button until the desktop mirror is ready", async () => {
    let release: (v: { workflows: never[] }) => void = () => {};
    (window as unknown as { penDesktop?: unknown }).penDesktop = {
      workflows: {
        list: () => new Promise((r) => (release = r)),
        save: async (d: { rev: number }) => ({ ok: true as const, rev: d.rev }),
        remove: async () => ({ ok: true as const }),
      },
    };
    try {
      const started = startDesktopWorkflowMirror();
      renderWorkflow("/workflow?new=1");
      expect(screen.queryByText("No workflows yet")).toBeNull();
      expect(screen.queryByRole("button", { name: /New workflow/ })).toBeNull();
      expect(listWorkflows()).toEqual([]);
      release({ workflows: [] });
      await started;
      await waitFor(() => expect(listWorkflows()).toHaveLength(1));
      await waitFor(() => expect(stepField(1)).toBeTruthy());
    } finally {
      resetDesktopWorkflowMirrorForTests();
      delete (window as unknown as { penDesktop?: unknown }).penDesktop;
    }
  });

  it("renders the steps of ?id= and sets the page title", () => {
    seed("Other", ["x"]);
    const target = seed("Target", ["Open the app", "Pick a theme"]);
    renderWorkflow(`/workflow?id=${target.id}`);
    expect((screen.getByLabelText("Workflow title") as HTMLInputElement).value).toBe("Target");
    expect(stepField(1).value).toBe("Open the app");
    expect(stepField(2).value).toBe("Pick a theme");
    expect(document.title).toBe("Target");
  });

  it("opens the newest workflow when no id is given", async () => {
    seed("Older", ["old"]);
    const newest = seed("Newest", ["new"]);
    renderWorkflow("/workflow");
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain(`id=${newest.id}`));
  });

  it("creates one workflow with one empty step for ?new=1 (even under StrictMode)", async () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/workflow?new=1&chat=off"]}>
          <WorkflowPage />
          <LocationProbe />
        </MemoryRouter>
      </StrictMode>,
    );
    await waitFor(() => expect(listWorkflows()).toHaveLength(1));
    const [meta] = listWorkflows();
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain(`id=${meta.id}`));
    const location = screen.getByTestId("location").textContent ?? "";
    expect(location).toContain("chat=off");
    expect(location).not.toContain("new=");
    expect(listWorkflows()).toHaveLength(1);
    expect(meta.title).toBe("Untitled workflow");
    expect(getWorkflow(meta.id)?.steps).toHaveLength(1);
  });

  it("adds a step with the end button, focuses it and saves", async () => {
    const wf = openSeeded(["A"]);
    clickLabel("Add step");
    expect(stepField(2)).toBe(document.activeElement);
    fireEvent.change(stepField(2), { target: { value: "B" } });
    await waitFor(() => expect(storedTexts(wf.id)).toEqual(["A", "B"]), SAVED);
  });

  it("inserts a step between two steps from the connector", async () => {
    const wf = openSeeded(["A", "C"]);
    clickLabel("Insert step after step 1");
    fireEvent.change(stepField(2), { target: { value: "B" } });
    await waitFor(() => expect(storedTexts(wf.id)).toEqual(["A", "B", "C"]), SAVED);
  });

  const chooseStepAction = async (n: number, action: string) => {
    clickLabel(`Step ${n} menu`);
    fireEvent.click(await screen.findByRole("menuitem", { name: action }));
  };

  it("deletes a step from its menu", async () => {
    const wf = openSeeded(["A", "B", "C"]);
    await chooseStepAction(2, "Delete");
    await waitFor(() => expect(storedTexts(wf.id)).toEqual(["A", "C"]), SAVED);
  });

  it.each([
    ["Move up", ["B", "A", "C"]],
    ["Move down", ["A", "C", "B"]],
    ["Duplicate", ["A", "B", "B", "C"]],
  ])("%s from the step menu persists the new order", async (action, expected) => {
    const wf = openSeeded(["A", "B", "C"]);
    await chooseStepAction(2, action);
    await waitFor(() => expect(storedTexts(wf.id)).toEqual(expected), SAVED);
  });

  it("adds a step below from the gutter", async () => {
    const wf = openSeeded(["A", "C"]);
    clickLabel("Add step after step 1");
    fireEvent.change(stepField(2), { target: { value: "B" } });
    await waitFor(() => expect(storedTexts(wf.id)).toEqual(["A", "B", "C"]), SAVED);
  });

  it("Enter adds the next step and Shift+Enter does not", async () => {
    const wf = openSeeded(["A"]);
    fireEvent.keyDown(stepField(1), { key: "Enter", shiftKey: true });
    expect(screen.queryByLabelText("Step 2")).toBeNull();
    fireEvent.keyDown(stepField(1), { key: "Enter" });
    expect(stepField(2)).toBe(document.activeElement);
    await waitFor(() => expect(storedTexts(wf.id)).toEqual(["A", ""]), SAVED);
  });

  it("Backspace in an empty step deletes it and focuses the previous one", async () => {
    const wf = openSeeded(["A", ""]);
    fireEvent.keyDown(stepField(2), { key: "Backspace" });
    expect(screen.queryByLabelText("Step 2")).toBeNull();
    expect(stepField(1)).toBe(document.activeElement);
    await waitFor(() => expect(storedTexts(wf.id)).toEqual(["A"]), SAVED);
  });

  it("Alt+ArrowUp moves the step", async () => {
    const wf = openSeeded(["A", "B"]);
    fireEvent.keyDown(stepField(2), { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(storedTexts(wf.id)).toEqual(["B", "A"]), SAVED);
  });

  it("adds a first step to a workflow without steps", async () => {
    const wf = openSeeded([]);
    expect(screen.getByText("No steps yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add first step/ }));
    await waitFor(() => expect(getWorkflow(wf.id)?.steps).toHaveLength(1), SAVED);
  });

  it("saves the title typed in the header", async () => {
    const wf = openSeeded(["A"], "Old");
    fireEvent.change(screen.getByLabelText("Workflow title"), { target: { value: "Renamed" } });
    await waitFor(() => expect(getWorkflow(wf.id)?.title).toBe("Renamed"), SAVED);
  });

  it("adopts a change written to the open workflow elsewhere", async () => {
    const wf = openSeeded(["before"]);
    act(() => {
      updateWorkflow(wf.id, { steps: stepsFromTexts(["after", "more"]) }, "agent");
    });
    await waitFor(() => expect(stepField(1).value).toBe("after"));
    expect(stepField(2).value).toBe("more");
    // The adoption must not echo back as an editor save.
    expect(getWorkflow(wf.id)?.rev).toBe(2);
  });

  it("lets the stored version win over a pending edit", async () => {
    const wf = openSeeded(["before"]);
    fireEvent.change(stepField(1), { target: { value: "typing" } });
    act(() => {
      updateWorkflow(wf.id, { steps: stepsFromTexts(["agent wrote this"]) }, "agent");
    });
    await waitFor(() => expect(stepField(1).value).toBe("agent wrote this"), SAVED);
    expect(storedTexts(wf.id)).toEqual(["agent wrote this"]);
  });

  it("falls back to the next workflow when the open one is deleted elsewhere", async () => {
    const keep = seed("Keep", ["keep"]);
    const gone = seed("Gone", ["gone"]);
    renderWorkflow(`/workflow?id=${gone.id}`);
    act(() => deleteWorkflow(gone.id, "agent"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain(`id=${keep.id}`));
  });

  it("switches workflows from the list and keeps other params", async () => {
    const a = seed("Alpha", ["a"]);
    seed("Beta", ["b"]);
    renderWorkflow("/workflow?chat=off");
    clickLabel("Workflows");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Alpha" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain(`id=${a.id}`));
    expect(screen.getByTestId("location").textContent).toContain("chat=off");
    expect(stepField(1).value).toBe("a");
  });

  it("asks before deleting a workflow", async () => {
    const wf = openSeeded(["x"], "Doomed");
    clickLabel("Workflow options");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete workflow/ }));
    await screen.findByText("This cannot be undone.");
    expect(getWorkflow(wf.id)).not.toBeNull();
    clickLabel("Delete");
    await waitFor(() => expect(getWorkflow(wf.id)).toBeNull());
  });

  it("copies the steps as a Markdown numbered list", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    openSeeded(["First", "Second"]);
    clickLabel("Workflow options");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Copy as Markdown/ }));
    expect(writeText).toHaveBeenCalledWith("1. First\n2. Second");
    vi.unstubAllGlobals();
  });

  it.each([
    ["Replace steps", ["New one", "New two"]],
    ["Add to end", ["Old", "New one", "New two"]],
  ])("pastes Markdown with %s", async (button, expected) => {
    const wf = openSeeded(["Old"]);
    clickLabel("Workflow options");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Paste from Markdown/ }));
    fireEvent.change(await screen.findByLabelText("Markdown"), { target: { value: "1. New one\n2. New two" } });
    clickLabel(button);
    await waitFor(() => expect(storedTexts(wf.id)).toEqual(expected), SAVED);
  });

  it("flushes a pending edit on pagehide", () => {
    const wf = openSeeded(["A"]);
    fireEvent.change(stepField(1), { target: { value: "typed just now" } });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(storedTexts(wf.id)).toEqual(["typed just now"]);
  });
});

describe("WorkflowPage schedule button", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("opens the schedule dialog and shows the schedule in the header after saving", async () => {
    openSeeded(["a"]);
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: /Every weekday at 09:00/ })).toBeTruthy();
  });
});
