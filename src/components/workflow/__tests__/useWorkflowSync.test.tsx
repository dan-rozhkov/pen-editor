import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { createWorkflow, stepsFromTexts } from "@/lib/workflows/workflowStore";
import { useWorkflowSync } from "../useWorkflowSync";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const wrapper = (initial: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>;
  };

const index = () => JSON.parse(localStorage.getItem("pen.workflows.index") ?? "[]") as { id: string }[];

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("useWorkflowSync stale index entries", () => {
  it("drops an index entry without a body and falls back to the next workflow", async () => {
    const good = createWorkflow({ title: "Good", steps: stepsFromTexts(["a"]) }, "editor");
    const stale = createWorkflow({ title: "Stale" }, "editor");
    localStorage.removeItem(`pen.workflows.wf.${stale.id}`);
    const { result } = renderHook(() => useWorkflowSync(), { wrapper: wrapper(`/workflow?id=${stale.id}`) });
    expect(result.current.id).toBe(good.id);
    await waitFor(() => expect(index().map((m) => m.id)).toEqual([good.id]));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("skips an unreadable body with one error toast and never writes or deletes it", async () => {
    const good = createWorkflow({ title: "Good", steps: stepsFromTexts(["a"]) }, "editor");
    const corrupt = createWorkflow({ title: "Corrupt" }, "editor");
    localStorage.setItem(`pen.workflows.wf.${corrupt.id}`, "{not json");
    const { result, rerender } = renderHook(() => useWorkflowSync(), { wrapper: wrapper(`/workflow?id=${corrupt.id}`) });
    expect(result.current.id).toBe(good.id);
    rerender();
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(`pen.workflows.wf.${corrupt.id}`)).toBe("{not json");
    expect(index().map((m) => m.id)).toContain(corrupt.id);
  });
});
