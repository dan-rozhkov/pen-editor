const HIDDEN = "[hidden]";

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => v !== null && typeof v === "object" && !Array.isArray(v);

function hideMap(v: unknown): unknown {
  if (!isRec(v)) return HIDDEN;
  return { [`${Object.keys(v).length} keys`]: HIDDEN };
}

function hideValues(v: unknown): unknown {
  if (!isRec(v)) return HIDDEN;
  return Object.fromEntries(Object.keys(v).map((k) => [k, HIDDEN]));
}

/**
 * Copy of a `browse_agent` input that is safe to print in the chat card: no
 * cookie values, storage keys or values, `type` step text, mock bodies or
 * header values. The original is never mutated.
 */
export function redactBrowseSetupInput(input: unknown): unknown {
  if (!isRec(input) || !isRec(input.setup)) return input;
  const setup: Rec = { ...input.setup };

  if (Array.isArray(setup.steps)) {
    setup.steps = setup.steps.map((s) => (isRec(s) && "text" in s ? { ...s, text: HIDDEN } : s));
  }
  if (Array.isArray(setup.network)) {
    setup.network = setup.network.map((r) => {
      if (!isRec(r)) return r;
      const out: Rec = { ...r };
      if ("body" in out) out.body = HIDDEN;
      if ("headers" in out) out.headers = hideValues(out.headers);
      return out;
    });
  }
  if (isRec(setup.storage)) {
    const storage: Rec = { ...setup.storage };
    if (Array.isArray(storage.cookies)) {
      storage.cookies = storage.cookies.map((c) => (isRec(c) && "value" in c ? { ...c, value: HIDDEN } : c));
    }
    if (Array.isArray(storage.origins)) {
      storage.origins = storage.origins.map((o) => {
        if (!isRec(o)) return o;
        const out: Rec = { ...o };
        if ("localStorage" in out) out.localStorage = hideMap(out.localStorage);
        if ("sessionStorage" in out) out.sessionStorage = hideMap(out.sessionStorage);
        return out;
      });
    }
    setup.storage = storage;
  }
  return { ...input, setup };
}
