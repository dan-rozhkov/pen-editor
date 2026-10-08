import { useVariableStore } from "@/store/variableStore";
import { usePageStore } from "@/store/pageStore";
import { useSceneStore } from "@/store/sceneStore";
import { selectComponentRegistry } from "@/store/componentRegistry";
import { useDocumentStore } from "@/store/documentStore";
import { buildLintInput } from "@/lib/designLint";
import { computeUsageReport } from "./computeReport";
import { USAGE_BUDGET_MS, type UsageInput, type UsageReport } from "./types";

/** The only impure function of the report: snapshot every page and the document's variables. */
export function buildUsageInput(opts: { lint?: boolean } = {}): UsageInput {
  const registry = selectComponentRegistry();
  const { pages, activePageId } = usePageStore.getState();
  const scene = useSceneStore.getState();
  return {
    pages: pages.map((p) => {
      // The active page lives in the scene store; its snapshot is stale.
      const src = p.id === activePageId ? scene : p;
      return { id: p.id, nodesById: src.nodesById, rootIds: src.rootIds, childrenById: src.childrenById };
    }),
    variables: useVariableStore.getState().variables,
    registry,
    pins: useDocumentStore.getState().libraries,
    lint: opts.lint === false ? null : buildLintInput(registry),
  };
}

/** Build the input and compute the report in one budget: building the lint input counts against it. */
export function buildUsageReport(): UsageReport {
  const started = Date.now();
  const input = buildUsageInput();
  return computeUsageReport(input, { budgetMs: Math.max(0, USAGE_BUDGET_MS - (Date.now() - started)) });
}
