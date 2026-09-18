import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { OpenCodeKeyDialog } from "../OpenCodeKeyDialog";

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

function getInput(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(
    'input[aria-label="OpenCode key"]',
  );
  if (!el) throw new Error("OpenCode key input not found");
  return el;
}

function getCheckButton(): HTMLButtonElement {
  const button = screen.getByRole("button", { name: /^Check(ing…)?$/ });
  return button as HTMLButtonElement;
}

/** A fetch mock whose response only resolves when the test tells it to —
 * lets a test hold a "Check" request open while the user keeps editing. */
function makeDeferredFetch() {
  const pending: Array<{
    key: string | null;
    resolve: (body: unknown) => void;
    reject: (err: unknown) => void;
  }> = [];
  const fetchMock = vi.fn(
    (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const headers = new Headers(init?.headers);
        pending.push({
          key: headers.get("X-OpenCode-Key"),
          resolve: (body: unknown) => resolve(jsonResponse(body)),
          reject,
        });
      }),
  );
  return { fetchMock, pending };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<OpenCodeKeyDialog /> check-key race (defect 3)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: false })));
  });

  // Defect 3 (code review): handleCheck used to apply whatever response
  // came back unconditionally — so editing the key WHILE a check for the
  // previous value was still in flight, then letting that stale response
  // land, painted a verdict for the OLD key onto the NEW, unverified one.
  // The fix compares the response against the live input (and the dialog's
  // open state) before applying it.
  it("ignores a check response for a key that no longer matches the input", async () => {
    const { fetchMock, pending } = makeDeferredFetch();
    vi.stubGlobal("fetch", fetchMock);

    render(<OpenCodeKeyDialog open onOpenChange={() => {}} />);

    fireEvent.change(getInput(), { target: { value: "sk-old" } });
    fireEvent.click(getCheckButton());
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].key).toBe("sk-old");

    // Edit the key before the in-flight check's response arrives.
    fireEvent.change(getInput(), { target: { value: "sk-new" } });
    expect(getInput().value).toBe("sk-new");

    // The stale response for "sk-old" now lands, claiming success.
    await act(async () => {
      pending[0].resolve({ ok: true, models: ["a", "b"] });
      // Let the response's .json() microtask and the resulting setState settle.
      await Promise.resolve();
      await Promise.resolve();
    });

    // Must NOT show a "Key accepted" verdict — it would be lying about the
    // key currently in the input, which was never checked.
    expect(screen.queryByText(/Key accepted/)).toBeNull();
    expect(getInput().value).toBe("sk-new");
  });

  // Same guard, closed-dialog variant: a response landing after the dialog
  // was closed (and, per the `wasOpen` reset-on-reopen logic, possibly
  // already reopened fresh) must not resurrect stale state into it.
  it("ignores a check response that arrives after the dialog has closed", async () => {
    const { fetchMock, pending } = makeDeferredFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <OpenCodeKeyDialog open onOpenChange={() => {}} />,
    );

    fireEvent.change(getInput(), { target: { value: "sk-old" } });
    fireEvent.click(getCheckButton());
    await waitFor(() => expect(pending).toHaveLength(1));

    rerender(<OpenCodeKeyDialog open={false} onOpenChange={() => {}} />);

    await act(async () => {
      pending[0].resolve({ ok: true, models: ["a"] });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Reopen fresh — the input must be blank, not carrying a verdict from
    // the check that was in flight when it closed.
    rerender(<OpenCodeKeyDialog open onOpenChange={() => {}} />);
    expect(getInput().value).toBe("");
    expect(screen.queryByText(/Key accepted/)).toBeNull();
  });

  // "Кнопку «Check» блокировать, пока проверка идёт" — a second click while
  // the first request is still in flight must not fire a second request.
  it("does not start a second check while one is already in flight", async () => {
    const { fetchMock, pending } = makeDeferredFetch();
    vi.stubGlobal("fetch", fetchMock);

    render(<OpenCodeKeyDialog open onOpenChange={() => {}} />);

    fireEvent.change(getInput(), { target: { value: "sk-double" } });
    fireEvent.click(getCheckButton());
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(getCheckButton().disabled).toBe(true);

    fireEvent.click(getCheckButton());
    // Still only the one request — the second click was a no-op.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending[0].resolve({ ok: true, models: ["a"] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getCheckButton().disabled).toBe(false);
  });
});
