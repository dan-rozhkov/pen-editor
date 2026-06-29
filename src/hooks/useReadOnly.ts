import { createContext, useContext } from "react";

/** Shared context flag — true when the surrounding panel is non-editable. */
export const ReadOnlyContext = createContext(false);

/** True when the surrounding panel should be non-editable (view mode). */
export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}
