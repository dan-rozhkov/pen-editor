import { it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { UIMessage } from "ai";
import { MessageList } from "../MessageList";

afterEach(() => cleanup());

function assistantWithPart(part: unknown): UIMessage {
  return { id: "m1", role: "assistant", parts: [part] } as unknown as UIMessage;
}

function skillManagePart(overrides: Record<string, unknown>) {
  return {
    type: "tool-skill_manage",
    toolCallId: "call-skill",
    state: "output-available",
    ...overrides,
  };
}

it.each([
  [
    "create",
    { action: "create", name: "reading-canvas-state", description: "How to read the canvas" },
    'Created skill "reading-canvas-state". It will appear in your skills catalog.',
    "Created skill reading-canvas-state: How to read the canvas",
  ],
  [
    "revive (create that revived an archived skill)",
    { action: "create", name: "old-skill" },
    'Revived archived skill "old-skill" with new content.',
    "Restored skill old-skill",
  ],
  [
    "patch",
    { action: "patch", name: "reading-canvas-state", old_string: "foo", new_string: "bar" },
    'Patched skill "reading-canvas-state".',
    "Updated skill reading-canvas-state: foo → bar",
  ],
  [
    "delete",
    { action: "delete", name: "old-skill", absorbed_into: "new-skill" },
    'Deleted skill "old-skill" (pruned).',
    "Deleted skill old-skill (merged into new-skill)",
  ],
])("renders a collapsed 'Memory updated' row with details for a successful %s", (_name, input, message, line) => {
  render(
    <MessageList
      messages={[assistantWithPart(skillManagePart({ input, output: JSON.stringify({ ok: true, message }) }))]}
      isLoading={false}
    />,
  );
  expect(screen.queryByText("Done")).toBeNull();
  expect(screen.queryByText(line)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Memory updated/ }));
  expect(screen.getByText(line)).toBeTruthy();
});

it("falls back to the generic ToolCallIndicator when skill_manage returns an error (e.g. curated guard)", () => {
  render(
    <MessageList
      messages={[
        assistantWithPart(
          skillManagePart({
            input: { action: "patch", name: "prototype" },
            output: JSON.stringify({ error: '"prototype" is a curated skill.' }),
          }),
        ),
      ]}
      isLoading={false}
    />,
  );
  expect(screen.queryByText("Memory updated")).toBeNull();
  expect(screen.getByText("Manage skill")).toBeTruthy();
});

it("treats an unparseable or unexpected output shape as non-success rather than throwing", () => {
  render(
    <MessageList
      messages={[
        assistantWithPart(
          skillManagePart({
            input: { action: "create", name: "x" },
            output: "not json",
          }),
        ),
      ]}
      isLoading={false}
    />,
  );
  expect(screen.getByText("Manage skill")).toBeTruthy();
});

it("treats a success output missing a usable input (e.g. unknown action) as non-success", () => {
  render(
    <MessageList
      messages={[
        assistantWithPart(
          skillManagePart({
            input: { action: "rename", name: "x" },
            output: JSON.stringify({ ok: true, message: "whatever" }),
          }),
        ),
      ]}
      isLoading={false}
    />,
  );
  expect(screen.getByText("Manage skill")).toBeTruthy();
});

it("falls back to the generic ToolCallIndicator when the skill_manage call errored", () => {
  render(
    <MessageList
      messages={[
        assistantWithPart({
          type: "tool-skill_manage",
          toolCallId: "call-skill-err",
          state: "output-error",
          input: { action: "patch", name: "x" },
          errorText: "boom",
        }),
      ]}
      isLoading={false}
    />,
  );
  expect(screen.getByText("Manage skill")).toBeTruthy();
  expect(screen.getByText("Error")).toBeTruthy();
});

// skill_view is only ever offered to the background-review LLM call
// (review.ts), never to the foreground turn that streams to this UI
// (chatTurn.ts passes includeView: false), so it has no entry in
// toolDisplayNames and can never actually reach MessageList in practice.
// This still exercises the generic fallback path — an unmapped tool name
// renders as an ordinary indicator using its raw name, not a crash — as a
// safety net for any future/unexpected tool type.
it("renders an unmapped tool (e.g. skill_view) as an ordinary tool indicator using its raw name, not a chip", () => {
  render(
    <MessageList
      messages={[
        assistantWithPart({
          type: "tool-skill_view",
          toolCallId: "call-view",
          state: "output-available",
          input: { name: "reading-canvas-state" },
          output: JSON.stringify({ name: "reading-canvas-state", description: "...", body: "..." }),
        }),
      ]}
      isLoading={false}
    />,
  );
  expect(screen.getByText("skill_view")).toBeTruthy();
});
