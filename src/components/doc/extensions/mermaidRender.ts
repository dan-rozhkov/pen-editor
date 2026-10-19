// Pele is loaded on first use so it stays out of the initial /doc chunk.
type PeleLazy = typeof import("pele/lazy");

let loading: Promise<PeleLazy> | null = null;

export function renderMermaid(source: string): Promise<string> {
  loading ??= import("pele/lazy");
  return loading.then((pele) => pele.renderAsync(source, { links: false, images: false })).then((result) => result.svg);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
