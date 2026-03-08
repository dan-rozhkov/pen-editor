import type { SceneState } from "./types";

export function createInstanceOperations(
  _get: () => SceneState,
  _set: (partial: Partial<SceneState> | ((state: SceneState) => Partial<SceneState>)) => void,
) {
  return {};
}
