import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { messageToMarkdown } from "@/lib/chatExport";

describe("messageToMarkdown: browse_agent", () => {
  it("never writes setup secrets into the export", () => {
    const msg = {
      id: "m1",
      role: "assistant",
      parts: [
        {
          type: "tool-browse_agent",
          toolCallId: "tc-1",
          state: "input-available",
          input: {
            goal: "g",
            setup: {
              steps: [{ action: "type", selector: "#p", text: "SECRET-TYPED" }],
              network: [{ url: "https://api.test/*", body: "SECRET-BODY", headers: { authorization: "SECRET-HEADER" } }],
              storage: {
                cookies: [{ name: "sid", value: "SECRET-COOKIE", domain: "a.test" }],
                origins: [{ origin: "https://a.test", localStorage: { SECRET_KEY: "SECRET-STORAGE" } }],
              },
            },
          },
        },
      ],
    } as unknown as UIMessage;
    const md = messageToMarkdown(msg);
    for (const s of ["SECRET-TYPED", "SECRET-BODY", "SECRET-HEADER", "SECRET-COOKIE", "SECRET_KEY", "SECRET-STORAGE"]) {
      expect(md).not.toContain(s);
    }
    expect(md).toContain("[hidden]");
  });
});
