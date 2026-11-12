import { afterEach, describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { addByokModel, clearByokConfig, setByokConnection } from "@/lib/byokProvider";
import { createChatTransport } from "@/lib/chatTransport";

afterEach(() => clearByokConfig());

async function headersFor(model: string): Promise<{ headers: Headers; body: string }> {
  let seen: { headers: Headers; body: string } | undefined;
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    seen = { headers: new Headers(init?.headers), body: String(init?.body) };
    return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  const transport = createChatTransport({ body: () => ({ model }), fetchImpl });
  const messages: UIMessage[] = [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }];
  await transport.sendMessages({ chatId: "c", messages, trigger: "submit-message", messageId: undefined, abortSignal: undefined });
  if (!seen) throw new Error("fetch was not called");
  return seen;
}

describe("chat transport BYOK headers", () => {
  it("sends base URL and key on a byok turn, and never in the body", async () => {
    setByokConnection("https://api.example.com/v1", "sk-own");
    addByokModel({ id: "m" });
    const { headers, body } = await headersFor("byok/m");
    expect(headers.get("X-BYOK-Base-URL")).toBe("https://api.example.com/v1");
    expect(headers.get("X-BYOK-Key")).toBe("sk-own");
    expect(body).not.toContain("sk-own");
  });

  it("sends nothing on other turns", async () => {
    setByokConnection("https://api.example.com/v1", "sk-own");
    const { headers } = await headersFor("deepseek/deepseek-v4.1-flash");
    expect(headers.has("X-BYOK-Key")).toBe(false);
    expect(headers.has("X-BYOK-Base-URL")).toBe(false);
  });

  it("sends no headers on a byok turn when nothing is configured", async () => {
    const { headers } = await headersFor("byok/m");
    expect(headers.has("X-BYOK-Key")).toBe(false);
  });

  it("skips a header whose value fetch would reject instead of throwing", async () => {
    localStorage.setItem(
      "pen.byok.v1",
      JSON.stringify({ baseUrl: "https://api.example.com/v1", apiKey: "sk-ключ", models: [{ id: "m" }] }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: "pen.byok.v1" }));
    const { headers } = await headersFor("byok/m");
    expect(headers.get("X-BYOK-Base-URL")).toBe("https://api.example.com/v1");
    expect(headers.has("X-BYOK-Key")).toBe(false);
  });
});
