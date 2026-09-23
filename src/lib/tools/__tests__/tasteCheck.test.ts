import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  runTasteCheckForEmbeds,
  runTasteCheckForToolCall,
  resetTasteCheckRounds,
  resetTasteCheckKillSwitch,
  resetTasteCheckBreaker,
  mergeTasteFeedback,
} from "@/lib/tools/tasteCheck";
import { recordTouchedEmbeds, resetTouchedEmbedsRegistry } from "@/lib/tools/tasteCheckRegistry";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function seedEmbed(id: string, htmlContent: string, extra: Record<string, unknown> = {}) {
  const node = {
    id,
    type: "embed",
    name: "Screen",
    x: 0,
    y: 0,
    width: 390,
    height: 844,
    htmlContent,
    ...extra,
  } as unknown as FlatSceneNode;
  const state = useSceneStore.getState();
  useSceneStore.setState({
    nodesById: { ...state.nodesById, [id]: node },
    parentById: { ...state.parentById, [id]: null },
    rootIds: [...state.rootIds, id],
    _cachedTree: null,
  });
}

beforeEach(() => {
  resetStores();
  resetTasteCheckRounds();
  resetTasteCheckKillSwitch();
  resetTasteCheckBreaker();
  resetTouchedEmbedsRegistry();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runTasteCheckForEmbeds", () => {
  it("returns feedback for a checked outcome and sends round 1 for a fresh embed", async () => {
    seedEmbed("e1", "<div>Screen</div>");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ outcome: "checked", screens: [], feedback: "Fix the contrast." }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const feedback = await runTasteCheckForEmbeds(["e1"]);

    expect(feedback).toBe("Fix the contrast.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.round).toBe(1);
    expect(body.screens).toEqual([{ id: "e1", name: "Screen", html: "<div>Screen</div>" }]);
  });

  it("returns null and does not call fetch when there are no embeds among the ids", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const feedback = await runTasteCheckForEmbeds(["nope"]);
    expect(feedback).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips non-embed nodes and embeds with empty htmlContent", async () => {
    seedEmbed("empty", "");
    const state = useSceneStore.getState();
    useSceneStore.setState({
      nodesById: {
        ...state.nodesById,
        rect1: { id: "rect1", type: "rect", name: "R", x: 0, y: 0, width: 10, height: 10 } as unknown as FlatSceneNode,
      },
      rootIds: [...state.rootIds, "rect1"],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const feedback = await runTasteCheckForEmbeds(["empty", "rect1"]);
    expect(feedback).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null on a non-200, non-kill-switch response", async () => {
    seedEmbed("e1", "<div>Screen</div>");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));
    const feedback = await runTasteCheckForEmbeds(["e1"]);
    expect(feedback).toBeNull();
  });

  it("returns null on a network error", async () => {
    seedEmbed("e1", "<div>Screen</div>");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const feedback = await runTasteCheckForEmbeds(["e1"]);
    expect(feedback).toBeNull();
  });

  it("returns null when the request aborts (timeout)", async () => {
    seedEmbed("e1", "<div>Screen</div>");
    // Simulates AbortSignal.timeout firing (fetch rejects with an
    // AbortError) without waiting out the real ~8s timeout — the handler's
    // fail-open catch treats any rejection identically, so this exercises
    // the same code path the real timeout would.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("Aborted", "AbortError");
      }),
    );
    const feedback = await runTasteCheckForEmbeds(["e1"]);
    expect(feedback).toBeNull();
  });

  it("returns null when outcome is 'failed' or 'nothing-to-check' without tripping the kill switch", async () => {
    seedEmbed("e1", "<div>Screen</div>");
    for (const outcome of ["failed", "nothing-to-check"] as const) {
      const fetchMock = vi.fn(async () => jsonResponse({ outcome, feedback: null }));
      vi.stubGlobal("fetch", fetchMock);
      const feedback = await runTasteCheckForEmbeds(["e1"]);
      expect(feedback).toBeNull();
    }
    // Kill switch must NOT have tripped — a fresh embed still triggers a fetch.
    resetTasteCheckRounds();
    const fetchMock = vi.fn(async () => jsonResponse({ outcome: "checked", feedback: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    await runTasteCheckForEmbeds(["e1"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("only increments the round count when outcome is 'checked'", async () => {
    seedEmbed("e1", "<div>Screen</div>");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ outcome: "failed", feedback: null })));
    await runTasteCheckForEmbeds(["e1"]);

    // Round should still be 1 (no completed check yet) on the next call.
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ outcome: "checked", feedback: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    await runTasteCheckForEmbeds(["e1"]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.round).toBe(1);
  });

  it("caps an embed at MAX_CHECKS_PER_EMBED completed checks — a third call does not fetch", async () => {
    seedEmbed("e1", "<div>Screen</div>");
    const fetchMock = vi.fn(async () =>
      jsonResponse({ outcome: "checked", screens: [{ id: "e1", findings: [] }], feedback: "one" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await runTasteCheckForEmbeds(["e1"]);
    expect(first).toBe("one");
    const second = await runTasteCheckForEmbeds(["e1"]);
    expect(second).toBe("one");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const third = await runTasteCheckForEmbeds(["e1"]);
    expect(third).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends round 2 for a second check on the same embed", async () => {
    seedEmbed("e1", "<div>Screen</div>");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ outcome: "checked", screens: [{ id: "e1", findings: [] }], feedback: "one" }),
      ),
    );
    await runTasteCheckForEmbeds(["e1"]);

    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ outcome: "checked", feedback: "two" }));
    vi.stubGlobal("fetch", fetchMock);
    await runTasteCheckForEmbeds(["e1"]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.round).toBe(2);
  });

  it("only credits a completed round to ids the backend actually returned in `screens`, not every id sent", async () => {
    seedEmbed("e1", "<div>One</div>");
    seedEmbed("e2", "<div>Two</div>");
    // The backend fails open PER SCREEN: outcome "checked" for the request as
    // a whole, but e2 is silently omitted from `screens` (e.g. it failed just
    // for that one screen).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          outcome: "checked",
          screens: [{ id: "e1", findings: [] }],
          feedback: "ok",
        }),
      ),
    );
    await runTasteCheckForEmbeds(["e1", "e2"]);

    // e1 was credited: round 2 next time.
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ outcome: "checked", screens: [{ id: "e1", findings: [] }], feedback: "ok" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await runTasteCheckForEmbeds(["e1"]);
    const e1Body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(e1Body.round).toBe(2);

    // e2 was NOT credited: still round 1, not treated as already checked.
    const fetchMock2 = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ outcome: "checked", screens: [{ id: "e2", findings: [] }], feedback: "ok" }),
    );
    vi.stubGlobal("fetch", fetchMock2);
    await runTasteCheckForEmbeds(["e2"]);
    const e2Body = JSON.parse((fetchMock2.mock.calls[0][1] as RequestInit).body as string);
    expect(e2Body.round).toBe(1);
  });

  it("truncates a screen's name to 200 chars before sending (backend zod cap)", async () => {
    seedEmbed("e1", "<div>Screen</div>", { name: "n".repeat(250) });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ outcome: "checked", screens: [{ id: "e1", findings: [] }], feedback: "ok" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await runTasteCheckForEmbeds(["e1"]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.screens[0].name).toHaveLength(200);
  });

  it("caps a request at 8 screens, checking only the first 8 eligible", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `e${i}`);
    for (const id of ids) seedEmbed(id, `<div>${id}</div>`);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ outcome: "checked", feedback: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    await runTasteCheckForEmbeds(ids);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.screens).toHaveLength(8);
    expect(body.screens.map((s: { id: string }) => s.id)).toEqual(ids.slice(0, 8));
  });

  it("includes a truncated brief when provided", async () => {
    seedEmbed("e1", "<div>Screen</div>");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ outcome: "checked", feedback: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    const longBrief = "x".repeat(5000);
    await runTasteCheckForEmbeds(["e1"], { brief: longBrief });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.brief).toHaveLength(4000);
  });

  it("requireExistingCheck skips an embed with zero completed checks", async () => {
    seedEmbed("e1", "<div>Screen</div>");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const feedback = await runTasteCheckForEmbeds(["e1"], { requireExistingCheck: true });
    expect(feedback).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requireExistingCheck allows an embed that already has a completed check", async () => {
    seedEmbed("e1", "<div>Screen</div>");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ outcome: "checked", screens: [{ id: "e1", findings: [] }], feedback: "round 1" }),
      ),
    );
    await runTasteCheckForEmbeds(["e1"]);

    const fetchMock = vi.fn(async () => jsonResponse({ outcome: "checked", feedback: "round 2" }));
    vi.stubGlobal("fetch", fetchMock);
    const feedback = await runTasteCheckForEmbeds(["e1"], { requireExistingCheck: true });
    expect(feedback).toBe("round 2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("strips data: URIs and caps html length before sending", async () => {
    const longAttr = "a".repeat(10);
    const html = `<img src="data:image/png;base64,${longAttr}"><div>${"x".repeat(200_100)}</div>`;
    seedEmbed("e1", html);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ outcome: "checked", feedback: "ok" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await runTasteCheckForEmbeds(["e1"]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    const sentHtml: string = body.screens[0].html;
    expect(sentHtml).not.toContain("base64");
    expect(sentHtml).toContain("data:…");
    expect(sentHtml.length).toBeLessThanOrEqual(200_000);
  });

  describe("kill switch", () => {
    it("disables further checks after a 503 and does not upload HTML again", async () => {
      seedEmbed("e1", "<div>Screen</div>");
      seedEmbed("e2", "<div>Other</div>");
      const fetchMock = vi.fn(async () => jsonResponse({}, 503));
      vi.stubGlobal("fetch", fetchMock);

      const first = await runTasteCheckForEmbeds(["e1"]);
      expect(first).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const second = await runTasteCheckForEmbeds(["e2"]);
      expect(second).toBeNull();
      // No further fetch — the kill switch short-circuits before any request.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("disables further checks after a 404", async () => {
      seedEmbed("e1", "<div>Screen</div>");
      const fetchMock = vi.fn(async () => jsonResponse({}, 404));
      vi.stubGlobal("fetch", fetchMock);
      await runTasteCheckForEmbeds(["e1"]);

      seedEmbed("e2", "<div>Other</div>");
      const fetchMock2 = vi.fn();
      vi.stubGlobal("fetch", fetchMock2);
      await runTasteCheckForEmbeds(["e2"]);
      expect(fetchMock2).not.toHaveBeenCalled();
    });

    it("disables further checks when outcome is 'off'", async () => {
      seedEmbed("e1", "<div>Screen</div>");
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ outcome: "off", feedback: null })));
      await runTasteCheckForEmbeds(["e1"]);

      seedEmbed("e2", "<div>Other</div>");
      const fetchMock2 = vi.fn();
      vi.stubGlobal("fetch", fetchMock2);
      await runTasteCheckForEmbeds(["e2"]);
      expect(fetchMock2).not.toHaveBeenCalled();
    });

    it("disables further checks when outcome is 'no-client'", async () => {
      seedEmbed("e1", "<div>Screen</div>");
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ outcome: "no-client", feedback: null })));
      await runTasteCheckForEmbeds(["e1"]);

      seedEmbed("e2", "<div>Other</div>");
      const fetchMock2 = vi.fn();
      vi.stubGlobal("fetch", fetchMock2);
      await runTasteCheckForEmbeds(["e2"]);
      expect(fetchMock2).not.toHaveBeenCalled();
    });
  });

  describe("circuit breaker", () => {
    it("trips after 2 CONSECUTIVE timeouts, disabling further checks without a kill-switch response", async () => {
      seedEmbed("e1", "<div>Screen</div>");
      const timeoutFetch = vi.fn(async () => {
        throw new DOMException("Aborted", "TimeoutError");
      });
      vi.stubGlobal("fetch", timeoutFetch);

      await runTasteCheckForEmbeds(["e1"]);
      expect(timeoutFetch).toHaveBeenCalledTimes(1);

      await runTasteCheckForEmbeds(["e1"]);
      expect(timeoutFetch).toHaveBeenCalledTimes(2);

      // A third call must not even fetch — the breaker tripped after the
      // second consecutive timeout.
      const thirdFetch = vi.fn();
      vi.stubGlobal("fetch", thirdFetch);
      const feedback = await runTasteCheckForEmbeds(["e1"]);
      expect(feedback).toBeNull();
      expect(thirdFetch).not.toHaveBeenCalled();
    });

    it("trips after 2 CONSECUTIVE 5xx/network failures", async () => {
      seedEmbed("e1", "<div>Screen</div>");
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 502 })));
      await runTasteCheckForEmbeds(["e1"]);

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("network down");
        }),
      );
      await runTasteCheckForEmbeds(["e1"]);

      const thirdFetch = vi.fn();
      vi.stubGlobal("fetch", thirdFetch);
      const feedback = await runTasteCheckForEmbeds(["e1"]);
      expect(feedback).toBeNull();
      expect(thirdFetch).not.toHaveBeenCalled();
    });

    it("resets the counter on any successful response, so an isolated failure never trips it", async () => {
      seedEmbed("e1", "<div>Screen</div>");
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
      await runTasteCheckForEmbeds(["e1"]);

      // A successful (2xx) response in between resets the consecutive count.
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse({ outcome: "checked", feedback: "ok" })),
      );
      await runTasteCheckForEmbeds(["e1"]);

      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
      await runTasteCheckForEmbeds(["e1"]);

      // Still only ONE failure since the last success — breaker must not
      // have tripped yet.
      const fetchMock = vi.fn(async () => jsonResponse({ outcome: "checked", feedback: "ok" }));
      vi.stubGlobal("fetch", fetchMock);
      const feedback = await runTasteCheckForEmbeds(["e1"]);
      expect(feedback).toBe("ok");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not count an abort caused by the CALLER's signal (Stop) as a breaker failure", async () => {
      seedEmbed("e1", "<div>Screen</div>");
      const controller = new AbortController();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }),
      );

      const pending = runTasteCheckForEmbeds(["e1"], undefined, controller.signal);
      controller.abort();
      const feedback = await pending;
      expect(feedback).toBeNull();

      // Two caller-aborted calls in a row must NOT trip the breaker — a
      // fresh call still fetches normally.
      const controller2 = new AbortController();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }),
      );
      const pending2 = runTasteCheckForEmbeds(["e1"], undefined, controller2.signal);
      controller2.abort();
      await pending2;

      const fetchMock = vi.fn(async () => jsonResponse({ outcome: "checked", feedback: "ok" }));
      vi.stubGlobal("fetch", fetchMock);
      const feedback3 = await runTasteCheckForEmbeds(["e1"]);
      expect(feedback3).toBe("ok");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe("runTasteCheckForToolCall", () => {
  it("batch_design: does not check a U() on an embed the agent never created (the user's own screen)", async () => {
    // Nothing created this embed via batch_design — it's exactly the "user's
    // own, hand-authored screen" case. A plain U() that gives it new
    // htmlContent records it as touched but NOT created (see the executor
    // integration tests), which is what this test simulates directly against
    // the registry.
    seedEmbed("user-embed", "<div>User's own screen</div>");
    recordTouchedEmbeds("call-1", ["user-embed"], []);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTasteCheckForToolCall("batch_design", "call-1", '{"success":true}');

    expect(result).toBe('{"success":true}');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("batch_design: checks an embed created (I()/R()/C()) in the same call", async () => {
    seedEmbed("new-embed", "<div>Freshly generated</div>");
    recordTouchedEmbeds("call-2", ["new-embed"], ["new-embed"]);
    const fetchMock = vi.fn(async () =>
      jsonResponse({ outcome: "checked", screens: [{ id: "new-embed", findings: [] }], feedback: "Nice work." }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTasteCheckForToolCall("batch_design", "call-2", '{"success":true}');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result).tasteCheck).toBe("Nice work.");
  });

  it("batch_design: checks a U() on an embed that already has a completed check, even though this call didn't create it", async () => {
    seedEmbed("checked-once", "<div>Screen</div>");
    // Give it one completed round from an earlier call.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ outcome: "checked", screens: [{ id: "checked-once", findings: [] }], feedback: "round 1" }),
      ),
    );
    await runTasteCheckForEmbeds(["checked-once"]);

    // Now a later batch_design call just does a plain U() on it — not in
    // `created` for THIS call — but it already has a completed check.
    recordTouchedEmbeds("call-3", ["checked-once"], []);
    const fetchMock = vi.fn(async () =>
      jsonResponse({ outcome: "checked", screens: [{ id: "checked-once", findings: [] }], feedback: "round 2" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTasteCheckForToolCall("batch_design", "call-3", '{"success":true}');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result).tasteCheck).toBe("round 2");
  });

  it("edit_embed_html: still requires an existing completed check, regardless of `created`", async () => {
    seedEmbed("never-checked", "<div>Screen</div>");
    recordTouchedEmbeds("call-4", ["never-checked"], []);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTasteCheckForToolCall("edit_embed_html", "call-4", '{"success":true}');

    expect(result).toBe('{"success":true}');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the result unchanged when nothing was recorded for the toolCallId", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await runTasteCheckForToolCall("batch_design", "no-such-call", '{"success":true}');
    expect(result).toBe('{"success":true}');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("mergeTasteFeedback", () => {
  it("adds a tasteCheck field to a JSON object result and keeps it valid JSON", () => {
    const result = JSON.stringify({ success: true, operationsExecuted: 1 });
    const merged = mergeTasteFeedback(result, "Increase contrast.");
    const parsed = JSON.parse(merged);
    expect(parsed).toEqual({ success: true, operationsExecuted: 1, tasteCheck: "Increase contrast." });
  });

  it("appends as plain text when the result is not JSON", () => {
    const merged = mergeTasteFeedback("plain text result", "Increase contrast.");
    expect(merged).toBe("plain text result\n\nIncrease contrast.");
  });

  it("appends as plain text when the result is a JSON array", () => {
    const result = JSON.stringify([1, 2, 3]);
    const merged = mergeTasteFeedback(result, "feedback");
    expect(merged).toBe(`${result}\n\nfeedback`);
  });
});
