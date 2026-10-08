import { useVariableStore } from "@/store/variableStore";
import { allPageNodes, selectComponentRegistry } from "@/store/componentRegistry";
import { useDocumentStore } from "@/store/documentStore";
import { buildLintInput } from "@/lib/designLint";
import type { UsageInput } from "./types";

/** The only impure function of the report: snapshot every page and the document's variables. */
export function buildUsageInput(opts: { lint?: boolean } = {}): UsageInput {
  const registry = selectComponentRegistry();
  return {
    pages: allPageNodes().map((p) => ({ id: p.pageId, nodesById: p.nodesById })),
    variables: useVariableStore.getState().variables,
    registry,
    pins: useDocumentStore.getState().libraries,
    lint: opts.lint === false ? null : buildLintInput(registry),
  };
}
