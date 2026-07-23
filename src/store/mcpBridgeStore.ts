import { create } from "zustand";

export type McpBridgeStatus = "off" | "connecting" | "connected";

interface McpBridgeState {
  status: McpBridgeStatus;
  setStatus: (status: McpBridgeStatus) => void;
}

export const useMcpBridgeStore = create<McpBridgeState>((set) => ({
  status: "off",
  setStatus: (status) => set({ status }),
}));
