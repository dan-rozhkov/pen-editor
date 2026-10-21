import { vi } from "vitest";

const open = new Set<FakeBroadcastChannel>();

/** Same-name channels deliver to each other (never to the sender), synchronously. */
export class FakeBroadcastChannel {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly name: string;
  constructor(name: string) {
    this.name = name;
    open.add(this);
  }
  postMessage(data: unknown): void {
    for (const other of open) {
      if (other !== this && other.name === this.name) other.onmessage?.({ data } as MessageEvent<unknown>);
    }
  }
  close(): void {
    open.delete(this);
  }
}

export function stubBroadcastChannel(): void {
  open.clear();
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
}
