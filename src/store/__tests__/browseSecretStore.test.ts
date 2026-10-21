import { beforeEach, describe, expect, it } from "vitest";
import { resetBrowseCheckpoints, useBrowseCheckpointStore } from "../browseCheckpointStore";
import {
  MAX_SECRETS_PER_CHAT,
  MIN_SECRET_LENGTH,
  redactAllSecrets,
  resetBrowseSecrets,
  secretNamesBody,
  useBrowseSecretStore,
} from "../browseSecretStore";

const store = () => useBrowseSecretStore.getState();

beforeEach(() => {
  resetBrowseSecrets();
  resetBrowseCheckpoints();
});

const checkpoint = (chatId: string) =>
  useBrowseCheckpointStore.getState().add(chatId, { fixture: { version: 1 }, complete: true, summary: "s" });

describe("browseSecretStore", () => {
  it("adds, replaces by name, removes and clears per chat", () => {
    expect(store().set("c1", "pw", "hunter22")).toEqual({ ok: true });
    expect(store().set("c1", "user", "alice@example.com")).toEqual({ ok: true });
    expect(store().set("c2", "pw", "other-chat")).toEqual({ ok: true });
    expect(store().namesFor("c1")).toEqual(["pw", "user"]);

    store().set("c1", "pw", "new-secret");
    expect(store().namesFor("c1")).toEqual(["pw", "user"]);
    expect(store().valuesFor("c1")).toEqual({ pw: "new-secret", user: "alice@example.com" });

    store().remove("c1", "pw");
    expect(store().namesFor("c1")).toEqual(["user"]);
    store().remove("c1", "user");
    expect("c1" in store().byChat).toBe(false);

    store().clearChat("c2");
    expect(store().namesFor("c2")).toEqual([]);
    expect(store().valuesFor("nope")).toEqual({});
  });

  it("refuses an illegal name and a short value", () => {
    for (const name of ["", "a b", "x".repeat(41), "p{w}", "pä"]) {
      expect(store().set("c1", name, "hunter22").ok).toBe(false);
    }
    const short = store().set("c1", "pw", "a".repeat(MIN_SECRET_LENGTH - 1));
    expect(short.ok === false && short.error).toContain(String(MIN_SECRET_LENGTH));
    expect(short.ok).toBe(false);
    expect(store().namesFor("c1")).toEqual([]);
  });

  it("caps a chat at 20 secrets but still allows replacing one", () => {
    for (let i = 0; i < MAX_SECRETS_PER_CHAT; i++) expect(store().set("c1", `s${i}`, "hunter22").ok).toBe(true);
    expect(store().set("c1", "extra", "hunter22").ok).toBe(false);
    expect(store().set("c1", "s0", "replaced-1").ok).toBe(true);
    expect(store().namesFor("c1")).toHaveLength(MAX_SECRETS_PER_CHAT);
  });

  it("secretNamesBody lists names only and is empty without secrets", () => {
    expect(secretNamesBody("c1")).toEqual({});
    expect(secretNamesBody(undefined)).toEqual({});
    store().set("c1", "pw", "hunter22");
    const body = secretNamesBody("c1");
    expect(body).toEqual({ browseSecrets: ["pw"] });
    expect(JSON.stringify(body)).not.toContain("hunter22");
  });

  it("remove and replace drop the chat's checkpoints and retire the old value for redaction", () => {
    store().set("c1", "pw", "old-secret-1");
    checkpoint("c1");
    checkpoint("c2");
    store().set("c1", "pw", "new-secret-2");
    expect(useBrowseCheckpointStore.getState().byChat.c1).toBeUndefined();
    expect(useBrowseCheckpointStore.getState().byChat.c2).toHaveLength(1);
    expect(store().valuesFor("c1")).toEqual({ pw: "new-secret-2" });
    expect(redactAllSecrets("a old-secret-1 b new-secret-2")).toBe("a {{secret:pw}} b {{secret:pw}}");

    checkpoint("c1");
    store().remove("c1", "pw");
    expect(useBrowseCheckpointStore.getState().byChat.c1).toBeUndefined();
    expect(redactAllSecrets("new-secret-2")).toBe("{{secret:pw}}");

    store().clearChat("c1");
    expect(redactAllSecrets("old-secret-1 new-secret-2")).toBe("old-secret-1 new-secret-2");
  });

  it("an identical re-set keeps checkpoints", () => {
    store().set("c1", "pw", "same-secret");
    checkpoint("c1");
    store().set("c1", "pw", "same-secret");
    expect(useBrowseCheckpointStore.getState().byChat.c1).toHaveLength(1);
  });

  it("redactAllSecrets unions every chat, handles a shared name, and passes text through without secrets", () => {
    expect(redactAllSecrets('{"a":"x"}')).toBe('{"a":"x"}');
    store().set("c1", "pw", "chat-one-pass");
    store().set("c2", "pw", "chat-two-pass");
    const out = redactAllSecrets(JSON.stringify({ t: "chat-one-pass and chat-two-pass" }));
    expect(out).not.toContain("chat-one-pass");
    expect(out).not.toContain("chat-two-pass");
    expect(redactAllSecrets("<input value='chat-one-pass'>", "text")).toBe("<input value='{{secret:pw}}'>");
  });
});
