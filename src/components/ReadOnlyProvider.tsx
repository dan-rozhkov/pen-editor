import { type ReactNode } from "react";
import { ReadOnlyContext } from "@/hooks/useReadOnly";

export function ReadOnlyProvider({
  value,
  children,
}: {
  value: boolean;
  children: ReactNode;
}) {
  return <ReadOnlyContext.Provider value={value}>{children}</ReadOnlyContext.Provider>;
}
