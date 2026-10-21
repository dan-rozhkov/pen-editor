import type { ToolHandler } from "../toolRegistry";
import { countFilledSteps, createWorkflow, getWorkflow, isWorkflowBodyMissing, listWorkflows, stepsFromTexts, updateWorkflow, type Workflow, type WorkflowStep } from "../workflows/workflowStore";
import { stepsToMarkdown } from "../workflows/workflowMarkdown";
import { getAgentPanelWorkflowsBridge } from "../agentPanel";

// Panel-local (canvasLink/canvasTools.ts, prefix "workflow_"): workflows live in this browser's
// localStorage (workflows/workflowStore.ts) and the desktop shell shows them in a /workflow tab.
// Advertised by the backend only when clientCapabilities.workflowTabs is true. Output: JSON string,
// `{"error": "..."}` on failure.

const MAX_STEPS = 100;

const err = (message: string): string => JSON.stringify({ error: message });

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Trimmed non-empty step texts, or an error message. */
function parseSteps(value: unknown): string[] | { error: string } {
  if (!Array.isArray(value) || value.some((s) => typeof s !== "string")) return { error: "steps must be an array of strings." };
  const texts = (value as string[]).map((s) => s.trim()).filter((s) => s.length > 0);
  if (texts.length === 0) return { error: "steps needs at least one non-empty step." };
  if (texts.length > MAX_STEPS) return { error: `A workflow has at most ${MAX_STEPS} steps (got ${texts.length}).` };
  return texts;
}

const unknownId = (id: string) => err(`Unknown workflowId "${id}". Call workflow_list to see the workflows.`);

/** Opens the workflow tab. Returns an error message, or undefined on success. */
async function openTab(workflowId: string): Promise<string | undefined> {
  const bridge = getAgentPanelWorkflowsBridge();
  if (!bridge) return "Workflow tabs are not available here (desktop app only). The workflow exists but no tab was opened.";
  try {
    const result = await bridge.open(workflowId);
    return result.ok ? undefined : result.error || "The workflow tab could not be opened.";
  } catch (e) {
    return e instanceof Error ? e.message : "The workflow tab could not be opened.";
  }
}

/** Only non-blank steps, numbered 1..n exactly like the markdown. */
function view(wf: Workflow) {
  const texts = wf.steps.map((s) => s.text.trim()).filter((t) => t.length > 0);
  return {
    workflowId: wf.id,
    title: wf.title,
    rev: wf.rev,
    steps: texts.map((text, i) => ({ index: i + 1, text })),
    markdown: stepsToMarkdown(texts),
  };
}

export const workflowList: ToolHandler = async () =>
  JSON.stringify({
    workflows: listWorkflows()
      // An index entry whose body is gone is not a workflow the agent can read or edit.
      .filter(({ id }) => !isWorkflowBodyMissing(id))
      .map(({ id, title, stepCount, updatedAt }) => ({ workflowId: id, title, stepCount, updatedAt })),
  });

export const workflowCreate: ToolHandler = async (args) => {
  const title = str(args?.title);
  if (title === undefined) return err("title is a required string.");
  const texts = parseSteps(args?.steps);
  if (!Array.isArray(texts)) return err(texts.error);
  let wf: Workflow;
  try {
    wf = createWorkflow({ title, steps: stepsFromTexts(texts) }, "agent");
  } catch (e) {
    return err(e instanceof Error ? e.message : "The workflow could not be saved.");
  }
  const openError = await openTab(wf.id);
  return JSON.stringify({
    workflowId: wf.id,
    title: wf.title,
    stepCount: countFilledSteps(wf.steps),
    markdown: stepsToMarkdown(texts),
    ...(openError ? { openError } : {}),
  });
};

export const workflowRead: ToolHandler = async (args) => {
  const id = str(args?.workflowId);
  if (!id) return err("workflowId is required.");
  const wf = getWorkflow(id);
  return wf ? JSON.stringify(view(wf)) : unknownId(id);
};

export const workflowEdit: ToolHandler = async (args) => {
  const id = str(args?.workflowId);
  if (!id) return err("workflowId is required.");
  const title = str(args?.title);
  const hasSteps = args?.steps !== undefined;
  if (title === undefined && !hasSteps) return err("Nothing to change: pass title or steps.");
  const current = getWorkflow(id);
  if (!current) return unknownId(id);
  const patch: { title?: string; steps?: WorkflowStep[] } = {};
  if (title !== undefined) patch.title = title;
  if (hasSteps) {
    const texts = parseSteps(args?.steps);
    if (!Array.isArray(texts)) return err(texts.error);
    // A step whose trimmed text equals an unused current step's keeps that id (first unused match in order),
    // so the open tab keeps its focus; anything else gets a new id.
    const used = new Set<number>();
    patch.steps = texts.map((text) => {
      const at = current.steps.findIndex((s, i) => !used.has(i) && s.text.trim() === text);
      if (at === -1) return stepsFromTexts([text])[0];
      used.add(at);
      return { id: current.steps[at].id, text };
    });
  }
  let updated;
  try {
    updated = updateWorkflow(id, patch, "agent");
  } catch (e) {
    return err(e instanceof Error ? e.message : "The workflow could not be saved.");
  }
  if (!updated || updated === "conflict") return unknownId(id);
  return JSON.stringify(view(updated));
};

export const workflowOpen: ToolHandler = async (args) => {
  const id = str(args?.workflowId);
  if (!id) return err("workflowId is required.");
  if (!getWorkflow(id)) return unknownId(id);
  const openError = await openTab(id);
  return openError ? err(openError) : JSON.stringify({ workflowId: id, opened: true });
};
