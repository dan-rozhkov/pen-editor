import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { extractStreamingToolInputs } from "@/hooks/streamingToolParts";

function assistantMessage(parts: unknown[]): UIMessage {
  return {
    id: "m1",
    role: "assistant",
    parts,
  } as unknown as UIMessage;
}

describe("extractStreamingToolInputs", () => {
  it("extracts streaming parts for multiple registered tool names", () => {
    const messages = [
      assistantMessage([
        {
          type: "tool-draw_vector",
          state: "input-streaming",
          toolCallId: "vec-1",
          input: { commands: "M(0,0)" },
        },
        {
          type: "tool-batch_design",
          state: "input-streaming",
          toolCallId: "batch-1",
          input: { operations: "f=I(document" },
        },
      ]),
    ];

    const result = extractStreamingToolInputs(
      messages,
      new Set(["draw_vector", "batch_design"])
    );

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        {
          toolName: "draw_vector",
          toolCallId: "vec-1",
          input: { commands: "M(0,0)" },
        },
        {
          toolName: "batch_design",
          toolCallId: "batch-1",
          input: { operations: "f=I(document" },
        },
      ])
    );
  });

  it("ignores tool names that are not in the requested set", () => {
    const messages = [
      assistantMessage([
        {
          type: "tool-edit_embed_html",
          state: "input-streaming",
          toolCallId: "edit-1",
          input: { nodeId: "n1" },
        },
      ]),
    ];

    expect(
      extractStreamingToolInputs(messages, new Set(["draw_vector"]))
    ).toEqual([]);
  });

  it("dedupes a toolCallId to its last occurrence, preserving stable order", () => {
    const messages = [
      assistantMessage([
        {
          type: "tool-draw_vector",
          state: "input-streaming",
          toolCallId: "vec-1",
          input: { commands: "M(0,0)" },
        },
        {
          type: "tool-batch_design",
          state: "input-streaming",
          toolCallId: "batch-1",
          input: { operations: "a" },
        },
      ]),
      assistantMessage([
        {
          type: "tool-draw_vector",
          state: "input-streaming",
          toolCallId: "vec-1",
          input: { commands: "M(0,0)\nL(1,1)" },
        },
      ]),
    ];

    const result = extractStreamingToolInputs(
      messages,
      new Set(["draw_vector", "batch_design"])
    );

    // Insertion-order-stable: vec-1 keeps its first-seen position even
    // though its value was overwritten by the second message's delta.
    expect(result).toEqual([
      {
        toolName: "draw_vector",
        toolCallId: "vec-1",
        input: { commands: "M(0,0)\nL(1,1)" },
      },
      {
        toolName: "batch_design",
        toolCallId: "batch-1",
        input: { operations: "a" },
      },
    ]);
  });

  it("ignores parts whose state is not input-streaming", () => {
    const messages = [
      assistantMessage([
        {
          type: "tool-draw_vector",
          state: "input-available",
          toolCallId: "vec-1",
          input: { commands: "M(0,0)" },
        },
        {
          type: "tool-draw_vector",
          state: "output-available",
          toolCallId: "vec-2",
          input: { commands: "M(0,0)" },
          output: "{}",
        },
      ]),
    ];

    expect(
      extractStreamingToolInputs(messages, new Set(["draw_vector"]))
    ).toEqual([]);
  });

  it("ignores parts whose input is missing, null, or not a plain object", () => {
    const messages = [
      assistantMessage([
        {
          type: "tool-draw_vector",
          state: "input-streaming",
          toolCallId: "vec-missing",
        },
        {
          type: "tool-draw_vector",
          state: "input-streaming",
          toolCallId: "vec-null",
          input: null,
        },
        {
          type: "tool-draw_vector",
          state: "input-streaming",
          toolCallId: "vec-array",
          input: ["not", "an", "object"],
        },
        {
          type: "tool-draw_vector",
          state: "input-streaming",
          toolCallId: "vec-string",
          input: "not an object",
        },
      ]),
    ];

    expect(
      extractStreamingToolInputs(messages, new Set(["draw_vector"]))
    ).toEqual([]);
  });

  it("ignores non-assistant messages and non-tool parts", () => {
    const messages: UIMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [
          {
            type: "tool-draw_vector",
            state: "input-streaming",
            toolCallId: "vec-1",
            input: { commands: "M(0,0)" },
          },
        ],
      } as unknown as UIMessage,
      assistantMessage([
        { type: "text", text: "hello" },
        { type: "step-start" },
      ]),
    ];

    expect(
      extractStreamingToolInputs(messages, new Set(["draw_vector"]))
    ).toEqual([]);
  });
});
