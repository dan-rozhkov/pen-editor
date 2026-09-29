import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ToolCallIndicator } from "../ToolCallIndicator";
import { LikedReferencesStrip } from "../LikedReferencesStrip";
import { ChatSessionIdContext } from "../ChatSessionContext";
import { useChatStore } from "@/store/chatStore";

const IMG = "https://cdn.example.com/a.png";
const SRC = "https://mobbin.com/screens/1";

function mobbinPart(imageUrl = IMG) {
  return {
    type: "tool-search_screens",
    toolCallId: "call-1",
    state: "output-available",
    input: {},
    output: {
      content: [
        { type: "text", text: JSON.stringify({ mobbin_url: SRC, image_url: imageUrl }) },
      ],
    },
  };
}

function renderIndicator(imageUrl?: string) {
  return render(
    <ChatSessionIdContext.Provider value="chat-1">
      <ToolCallIndicator part={mobbinPart(imageUrl)} />
    </ChatSessionIdContext.Provider>,
  );
}

beforeEach(() => useChatStore.setState({ likedReferences: {} }));
afterEach(() => cleanup());

describe("like reference toggle", () => {
  it("likes and unlikes a thumbnail, recording the citation and tool", () => {
    renderIndicator();
    const like = screen.getByRole("button", { name: "Like reference" });
    expect(like.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(like);
    expect(useChatStore.getState().likedReferences["chat-1"]).toEqual([
      { url: IMG, sourceUrl: SRC, tool: "search_screens" },
    ]);
    const unlike = screen.getByRole("button", { name: "Unlike reference" });
    expect(unlike.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(unlike);
    expect(useChatStore.getState().likedReferences).toEqual({});
  });

  it("offers no like button for data: URLs", () => {
    renderIndicator("data:image/png;base64,iVBORw0KGgo=");
    expect(screen.queryByRole("button", { name: /like reference/i })).toBeNull();
  });
});

describe("<LikedReferencesStrip />", () => {
  it("renders nothing when the chat has no likes", () => {
    const { container } = render(<LikedReferencesStrip sessionId="chat-1" />);
    expect(container.firstChild).toBeNull();
  });

  it("lists liked references and unlikes with the x control", () => {
    useChatStore.getState().toggleLikedReference("chat-1", { url: IMG });
    render(<LikedReferencesStrip sessionId="chat-1" />);
    expect(screen.getByText(/Liked references/)).toBeTruthy();
    expect(screen.getByAltText("Liked reference").getAttribute("src")).toBe(IMG);

    fireEvent.click(screen.getByRole("button", { name: "Unlike reference" }));
    expect(useChatStore.getState().likedReferences).toEqual({});
    expect(screen.queryByText(/Liked references/)).toBeNull();
  });
});
