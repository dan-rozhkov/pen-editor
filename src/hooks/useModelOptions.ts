import { useSyncExternalStore } from "react";
import {
  isModelListPending,
  getModelOptions,
  subscribeModels,
  type ChatModelOption,
} from "@/lib/chatModels";

// Reactive view of the backend-served model list. Re-renders when loadModels()
// resolves and swaps the cached list in.
export function useModelOptions(): ChatModelOption[] {
  return useSyncExternalStore(subscribeModels, getModelOptions, getModelOptions);
}

// Reactive view of "is GET /api/models still in flight". Used to hold back
// auto-sent launch payloads, which would otherwise leave with a model id from
// the hardcoded fallback list.
export function useModelListPending(): boolean {
  return useSyncExternalStore(
    subscribeModels,
    isModelListPending,
    isModelListPending,
  );
}
