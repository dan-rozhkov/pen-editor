/**
 * Shared types for the WebMCP surface.
 *
 * Two vocabularies meet here and they are deliberately kept apart:
 *
 * - *Registration* uses the WebMCP hint names `readOnlyHint` /
 *   `untrustedContentHint`, which is what an application passes to
 *   `registerTool`.
 * - *Discovery* exposes the shortened `readOnly` / `untrustedContent`, which
 *   is what a client reads back off `getTools()`.
 *
 * Native Chrome does the same translation, so a tool registered through the
 * polyfill and a tool registered through the native API look identical to a
 * client. Collapsing the two names into one would make our polyfill diverge
 * from the browser the moment it ships the API.
 */

/** JSON Schema subset this module understands. See validateInput.ts. */
export interface JsonSchema {
  type: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: readonly (string | number)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  maxItems?: number;
}

/** Annotations as passed to `registerTool`. */
export interface ToolAnnotationHints {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

/** Annotations as read back from `getTools()`. */
export interface ToolAnnotations {
  readOnly?: boolean;
  untrustedContent?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotationHints;
  execute: (input: unknown) => Promise<unknown>;
}

/** What a client sees. Deliberately carries no `execute`. */
export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: ToolAnnotations;
}

export interface ModelContextLike {
  registerTool(definition: ToolDefinition): Promise<void>;
  getTools(): Promise<ToolDescriptor[]>;
  /**
   * `args` is a JSON *string*, not an object — this matches the native API,
   * where passing a plain object fails with "Failed to parse input
   * arguments". Keeping the same signature means client code written against
   * Chrome's implementation works here unchanged.
   */
  executeTool(tool: ToolDescriptor | string, args: string): Promise<unknown>;
}
