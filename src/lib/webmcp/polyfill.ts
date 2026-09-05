import type {
  ModelContextLike,
  ToolDefinition,
  ToolDescriptor,
} from "./types";

/**
 * A WebMCP `navigator.modelContext` implementation for browsers that do not
 * ship one yet.
 *
 * Why this exists: WebMCP is not in any stable browser at the time of
 * writing (Chrome 152 exposes neither `document.modelContext` nor
 * `navigator.modelContext`), and the desktop shell is Electron, which will
 * lag Chrome stable by definition. Waiting for the API would mean shipping
 * nothing. A page-level implementation gives every agent that can run
 * JavaScript in the tab — the Chrome extension, Playwright, CDP, the
 * Electron shell's own webContents — the same discovery and invocation
 * surface the native API will provide.
 *
 * The contract with the future: this installs *only* when no native
 * implementation is present, and `getModelContext()` prefers the native one.
 * When Chrome ships the API, the polyfill stops installing itself and
 * registerTools.ts keeps working untouched, because it only ever talks to
 * whatever `getModelContext()` returns.
 *
 * Fidelity matters more than convenience here. Anywhere the native API is
 * awkward (arguments as a JSON string, errors flattened to a generic
 * message) this mirrors the awkwardness rather than improving on it — a
 * client that works against the polyfill must work against Chrome, and the
 * only way to guarantee that is to not be nicer than Chrome.
 */

/** The generic failure text the native layer reports to callers. */
export const INVOCATION_FAILED = "Tool invocation failed";

/**
 * Marks a registration as coming from the module that first claimed the name.
 *
 * Without it, `registerTool` replacing by name — which it must, for remounts
 * and hot reload — lets any later script in the page substitute its own
 * `execute` for a published tool. A client would never notice: `getTools()`
 * deliberately omits `execute`, so the descriptor of a hijacked tool is
 * byte-identical to the real one, and a poisoned result or a silently dropped
 * mutation looks like an honest answer.
 *
 * The claim lives on the definition rather than in a module variable so that
 * a hot reload — which gives the module a fresh scope but reuses the page's
 * context object — can still re-register its own tools.
 */
const OWNER = Symbol.for("pen-editor.webmcp.owner");

export interface OwnedToolDefinition extends ToolDefinition {
  [OWNER]?: unknown;
}

/** Stamps a definition so it may claim, or re-claim, its name. */
export function claimTool(definition: ToolDefinition): OwnedToolDefinition {
  return { ...definition, [OWNER]: OWNER };
}

class PolyfilledModelContext implements ModelContextLike {
  /** Registered by name: re-registering a name replaces the definition. */
  readonly #tools = new Map<string, OwnedToolDefinition>();

  async registerTool(definition: OwnedToolDefinition): Promise<void> {
    if (!definition || typeof definition.name !== "string" || !definition.name) {
      throw new Error("registerTool requires a tool with a name");
    }
    if (typeof definition.execute !== "function") {
      throw new Error(`Tool "${definition.name}" has no execute function`);
    }
    // Idempotent by name, matching the native API: remounting a React root
    // or a hot-module reload re-runs registration, and that must replace the
    // previous definition rather than accumulate duplicates. There is no
    // unregister handle in the native API, so there is none here either —
    // code that needs a tool to stop working must refuse inside `execute`
    // (see registerTools.ts's read-only gate), not rely on removal.
    //
    // Replacing a *claimed* name, however, requires the same claim. This is
    // not a defence against a page that already runs hostile script — such a
    // script can do far worse directly — it is so that a hijack cannot be
    // silent to the agent on the other side, which is the party that has no
    // way to detect it.
    const existing = this.#tools.get(definition.name);
    if (existing?.[OWNER] === OWNER && definition[OWNER] !== OWNER) {
      throw new Error(`Tool "${definition.name}" is already registered by this page`);
    }
    this.#tools.set(definition.name, definition);
  }

  async getTools(): Promise<ToolDescriptor[]> {
    return [...this.#tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      // Registration hints -> discovery names. See types.ts.
      annotations: {
        readOnly: tool.annotations?.readOnlyHint ?? false,
        untrustedContent: tool.annotations?.untrustedContentHint ?? false,
      },
    }));
  }

  async executeTool(
    tool: ToolDescriptor | string,
    args: string
  ): Promise<unknown> {
    const name = typeof tool === "string" ? tool : tool?.name;
    if (typeof name !== "string" || !name) {
      throw new Error("executeTool requires a tool or tool name");
    }
    const definition = this.#tools.get(name);
    if (!definition) {
      throw new Error(`Unknown tool: ${name}`);
    }

    // The native API takes arguments as a JSON string and rejects anything
    // else with this exact class of error. Accepting a plain object here
    // would let code pass the polyfill and then fail against Chrome.
    if (typeof args !== "string") {
      throw new Error("Failed to parse input arguments");
    }
    let parsed: unknown;
    try {
      parsed = args.trim() === "" ? {} : JSON.parse(args);
    } catch {
      throw new Error("Failed to parse input arguments");
    }

    try {
      return await definition.execute(parsed);
    } catch (error) {
      // The native layer does not forward a handler's message to the
      // caller. Mirroring that is not a cosmetic choice: it is why callers
      // must assert on rejected-vs-accepted rather than on error text, and
      // if the polyfill leaked real messages, client code would come to
      // depend on detail Chrome will never provide. Developers still need
      // the reason, so it goes to the console.
      console.error(`[webmcp] ${name} failed`, error);
      throw new Error(INVOCATION_FAILED);
    }
  }
}

interface ModelContextCarrier {
  modelContext?: ModelContextLike;
}

/**
 * The accessor every caller should use. Current Chrome builds that do expose
 * the API put it on `document`, while the specification direction is
 * `navigator`, so both are consulted — the fallback is load-bearing, not
 * defensive.
 */
export function getModelContext(): ModelContextLike | undefined {
  return (
    (navigator as unknown as ModelContextCarrier).modelContext ??
    (document as unknown as ModelContextCarrier).modelContext
  );
}

export interface PolyfillResult {
  /** A model context is available, from whatever source. */
  available: boolean;
  /** True when the browser provided it and we left it alone. */
  native: boolean;
}

/**
 * Installs the polyfill when the browser has no model context of its own.
 * Safe to call repeatedly: a second call finds the first one's object and
 * reports it as already installed rather than replacing it (which would drop
 * every tool registered against the first).
 */
export function installModelContextPolyfill(): PolyfillResult {
  const existing = getModelContext();
  if (existing) {
    return { available: true, native: !(existing instanceof PolyfilledModelContext) };
  }

  const context = new PolyfilledModelContext();
  try {
    publish(navigator, context);
  } catch (error) {
    // A future browser could define the property as non-configurable
    // between the read above and this write. Failing to install is not
    // fatal — the editor works fine without an agent surface — so report it
    // rather than taking the app down.
    console.error("[webmcp] could not install the model context polyfill", error);
    return { available: false, native: false };
  }

  // The same object is also published on `document`, because that is where
  // the Chrome builds that expose the API at all put it, and an agent looks
  // wherever its own reference says to look. A surface that exists only at
  // the address half the callers do not check is, for them, a surface that
  // does not exist — this cost a real agent a whole investigation before it
  // concluded the editor supports nothing. One object, two names: whichever
  // one a caller reads, it registers against and executes the same tools.
  //
  // Failing here is not fatal the way the `navigator` write is: the surface
  // is already installed and `getModelContext()` finds it, so the alias is
  // reported and skipped rather than unwinding a working install.
  try {
    publish(document, context);
  } catch (error) {
    console.error("[webmcp] could not alias the model context onto document", error);
  }
  return { available: true, native: false };
}

/** Defines `modelContext` on a host object with the native API's shape. */
function publish(host: object, context: ModelContextLike): void {
  Object.defineProperty(host, "modelContext", {
    value: context,
    configurable: true,
    enumerable: false,
    writable: false,
  });
}
