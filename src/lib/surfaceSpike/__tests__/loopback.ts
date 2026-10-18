// SPIKE(ipc-streaming): in-memory stand-in for the Electron main relay.
import type { SpikeDelivered, SpikeEnvelope, SpikeRole, SurfaceSpikeBridge } from "../types";
import { spikeNow } from "../types";

export interface Loopback {
  chat: SurfaceSpikeBridge;
  canvas: SurfaceSpikeBridge;
  /** Every envelope posted, in order, with the posting side. */
  log: Array<{ from: SpikeRole; env: SpikeEnvelope }>;
  /** Simulates the canvas tab closing. */
  killCanvas(): void;
  /** Drop deliveries to the canvas tab (a tab that does not answer). */
  muteCanvas: boolean;
  roles: Record<SpikeRole, boolean>;
}

export function createLoopback(): Loopback {
  const listeners: Record<SpikeRole, Set<(env: SpikeDelivered) => void>> = {
    chat: new Set(),
    canvas: new Set(),
  };
  const lb: Loopback = {
    log: [],
    muteCanvas: false,
    roles: { chat: false, canvas: false },
    chat: undefined as unknown as SurfaceSpikeBridge,
    canvas: undefined as unknown as SurfaceSpikeBridge,
    killCanvas() {
      lb.roles.canvas = false;
      deliver("chat", { id: "main", sentAt: spikeNow(), relayedAt: spikeNow(), msg: { kind: "peer-gone", role: "canvas" } });
    },
  };
  const deliver = (to: SpikeRole, env: SpikeDelivered) => {
    queueMicrotask(() => {
      for (const cb of [...listeners[to]]) cb(env);
    });
  };
  const make = (me: SpikeRole, peer: SpikeRole): SurfaceSpikeBridge => ({
    setRole(role) {
      lb.roles[me] = role === me;
    },
    post(env) {
      lb.log.push({ from: me, env });
      if (!lb.roles[peer] || (peer === "canvas" && lb.muteCanvas)) {
        if (!lb.roles[peer]) {
          deliver(me, {
            id: `err-${env.id}`,
            sentAt: spikeNow(),
            relayedAt: spikeNow(),
            msg: { kind: "error", refId: env.id, error: `no ${peer} tab` },
          });
        }
        return;
      }
      deliver(peer, { ...env, relayedAt: spikeNow() });
    },
    onMessage(cb) {
      listeners[me].add(cb);
      return () => listeners[me].delete(cb);
    },
  });
  lb.chat = make("chat", "canvas");
  lb.canvas = make("canvas", "chat");
  return lb;
}
