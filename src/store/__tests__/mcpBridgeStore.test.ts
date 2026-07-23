import { describe, expect, it, beforeEach } from "vitest";
import { useMcpBridgeStore } from "@/store/mcpBridgeStore";

beforeEach(() => {
  useMcpBridgeStore.setState({ status: "off" });
});

describe("mcpBridgeStore", () => {
  it("defaults to off", () => {
    expect(useMcpBridgeStore.getState().status).toBe("off");
  });

  it("setStatus transitions the status", () => {
    useMcpBridgeStore.getState().setStatus("connecting");
    expect(useMcpBridgeStore.getState().status).toBe("connecting");

    useMcpBridgeStore.getState().setStatus("connected");
    expect(useMcpBridgeStore.getState().status).toBe("connected");

    useMcpBridgeStore.getState().setStatus("off");
    expect(useMcpBridgeStore.getState().status).toBe("off");
  });
});
