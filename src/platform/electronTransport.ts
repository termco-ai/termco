import { bridge } from "../native/bridge";
import { unwrapCapabilityResult } from "./capabilityWire";
import type {
  CapabilityTransport,
  ProcessChannelListener,
} from "./remoteCapabilities";

interface ProcessChannelMessage {
  __termcoChannelArgs: unknown[];
}

export function deliverProcessChannelMessage(
  listener: (...messages: unknown[]) => void,
  message: unknown,
): void {
  const args = (message as Partial<ProcessChannelMessage> | null)
    ?.__termcoChannelArgs;
  if (!Array.isArray(args)) {
    throw new Error("invalid process channel message envelope");
  }
  listener(...args);
}

function registerProcessChannel(listener: ProcessChannelListener): number {
  return bridge().registerChannel((message) =>
    deliverProcessChannelMessage(
      listener as (...messages: unknown[]) => void,
      message,
    ),
  );
}

export function subscribeElectronHostEvent(
  name: string,
  listener: ProcessChannelListener,
): () => void {
  return bridge().onWindowEvent(name, (message) => listener(message));
}

export const electronCapabilityTransport: CapabilityTransport = Object.assign(
  async (call: Parameters<CapabilityTransport>[0]) =>
    unwrapCapabilityResult(await bridge().capabilityCallWire(call)),
  {
    registerChannel: registerProcessChannel,
    releaseChannel: (channelId: number) => bridge().releaseChannel(channelId),
    subscribeHostEvent: subscribeElectronHostEvent,
  },
);
