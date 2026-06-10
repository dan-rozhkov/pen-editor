import { useSyncExternalStore } from "react";
import {
  getModelOptions,
  subscribeModels,
  type ChatModelOption,
} from "@/lib/chatModels";

// Reactive view of the backend-served model list. Re-renders when loadModels()
// resolves and swaps the cached list in.
export function useModelOptions(): ChatModelOption[] {
  return useSyncExternalStore(subscribeModels, getModelOptions, getModelOptions);
}
