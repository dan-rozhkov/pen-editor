import { RightSidebar } from "./RightSidebar";
import { InspectPanel } from "./inspect/InspectPanel";
import { useDevModeStore } from "@/store/devModeStore";

/**
 * Swaps the right-hand panel between the normal properties `RightSidebar`
 * and the read-only `InspectPanel` while dev mode is active. Extracted from
 * `App.tsx` so the swap logic can be unit-tested without mounting the full
 * app (which pulls in PixiCanvas and other heavy, hard-to-test deps).
 */
export function RightPanel() {
  const isDev = useDevModeStore((s) => s.active);
  return isDev ? <InspectPanel /> : <RightSidebar />;
}
