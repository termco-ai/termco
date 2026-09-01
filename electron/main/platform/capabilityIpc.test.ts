import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: never[]) => unknown>(),
  listeners: new Map<string, (...args: never[]) => unknown>(),
  fromId: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: never[]) => unknown) =>
      electronMock.handlers.set(channel, handler),
    ),
    on: vi.fn((channel: string, listener: (...args: never[]) => unknown) =>
      electronMock.listeners.set(channel, listener),
    ),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  webContents: { fromId: electronMock.fromId },
}));

let attachAuthenticatedCaller: typeof import("./capabilityIpc").attachAuthenticatedCaller;
let attachRendererChannels: typeof import("./capabilityIpc").attachRendererChannels;
let RemoteDisposerRegistry: typeof import("./capabilityIpc").RemoteDisposerRegistry;
let CapabilityIpcHost: typeof import("./capabilityIpc").CapabilityIpcHost;
let mergePluginRemovalImpacts: typeof import("./capabilityIpc").mergePluginRemovalImpacts;

beforeAll(async () => {
  ({
    attachAuthenticatedCaller,
    attachRendererChannels,
    RemoteDisposerRegistry,
    CapabilityIpcHost,
    mergePluginRemovalImpacts,
  } = await import("./capabilityIpc"));
});

describe("renderer impact inspection", () => {
  it("merges duplicate multi-window impact without duplicating rows", () => {
    const impact = {
      blockedPlugins: [
        {
          pluginId: "workflows-native",
          missingServices: ["git.repository"],
          via: ["git.repository"],
        },
      ],
      unavailableFeatures: [],
      degradedPlugins: [],
      destructiveResources: [],
    };
    expect(mergePluginRemovalImpacts([impact, impact])).toEqual(impact);
  });
});

beforeEach(() => {
  electronMock.handlers.clear();
  electronMock.listeners.clear();
  electronMock.fromId.mockReset();
  vi.useRealTimers();
});

const rendererProfile = {
  generation: "renderer-input",
  profileId: "test.profile",
  plugins: [],
  activationOrder: [],
  modules: [],
  catalog: [],
};

function rendererSender(id: number) {
  return {
    id,
    isDestroyed: () => false,
    once: vi.fn(),
    send: vi.fn(),
  };
}

function replacementResult(
  sender: ReturnType<typeof rendererSender>,
  requestId: string,
  ok: boolean,
  generation?: string,
) {
  const request = sender.send.mock.calls.find(
    (call) => (call[1] as { requestId?: string })?.requestId === requestId,
  )?.[1] as
    | { change?: { profile?: { generation?: string } } }
    | undefined;
  electronMock.listeners.get("termco:plugins:renderer-profile-change-result")?.(
    { sender } as never,
    {
      requestId,
      ok,
      generation: generation ?? request?.change?.profile?.generation,
      ...(ok ? {} : { error: "renderer failed" }),
    } as never,
  );
}

describe("renderer replacement convergence", () => {
  it("authenticates renderer generations and gates only the quiesced generation", async () => {
    const sender = rendererSender(40);
    electronMock.fromId.mockReturnValue(sender);
    const dispatch = vi.fn(async () => "provider-result");
    const host = new CapabilityIpcHost(
      {
        providerRuntime: {
          serviceProviders: () => [
            { name: "terminal.pty", providerId: "pty-native" },
          ],
        },
        dispatch,
      } as never,
      rendererProfile,
    );
    const initial = electronMock.handlers
      .get("termco:plugins:renderer-profile")
      ?.({ sender } as never) as { generation: string };
    expect(initial.generation).toEqual(expect.any(String));
    const capabilityCall = electronMock.handlers.get("termco:services:call");
    const call = (generation?: string) =>
      capabilityCall?.(
        { sender } as never,
        {
          consumerPluginId: "terminal-surface-native",
          capability: "terminal.pty",
          method: "write",
          args: [1, "pwd"],
          ...(generation ? { rendererGeneration: generation } : {}),
        } as never,
      );

    await expect(call()).resolves.toMatchObject({ ok: false });
    await expect(call("unknown-generation")).resolves.toMatchObject({
      ok: false,
    });
    expect(dispatch).not.toHaveBeenCalled();

    const quiesce = host.quiesceRendererProfiles(
      rendererProfile,
      ["terminal-provider-row"],
      ["pty-native"],
    );
    const quiesceRequest = sender.send.mock.calls[0]?.[1] as {
      requestId: string;
      change: { profile: { generation: string } };
    };
    expect(quiesceRequest.change.profile.generation).toBe(initial.generation);
    replacementResult(sender, quiesceRequest.requestId, true, initial.generation);
    await quiesce;
    await expect(call(initial.generation)).resolves.toMatchObject({ ok: false });

    const activate = host.replaceRendererProfiles(rendererProfile);
    const candidateRequest = sender.send.mock.calls[1]?.[1] as {
      requestId: string;
      change: { profile: { generation: string } };
    };
    const candidateGeneration = candidateRequest.change.profile.generation;
    expect(candidateGeneration).not.toBe(initial.generation);
    await expect(call(candidateGeneration)).resolves.toMatchObject({
      ok: true,
      value: "provider-result",
    });
    replacementResult(sender, candidateRequest.requestId, true, candidateGeneration);
    await activate;
    await expect(call(initial.generation)).resolves.toMatchObject({ ok: false });

    const candidateQuiesce = host.quiesceRendererProfiles(
      rendererProfile,
      ["terminal-provider-row"],
      ["pty-native"],
    );
    const candidateQuiesceRequest = sender.send.mock.calls[2]?.[1] as {
      requestId: string;
    };
    replacementResult(
      sender,
      candidateQuiesceRequest.requestId,
      true,
      candidateGeneration,
    );
    await candidateQuiesce;

    const rollback = host.restoreRendererProfiles(rendererProfile);
    const rollbackRequest = sender.send.mock.calls[3]?.[1] as {
      requestId: string;
      change: { profile: { generation: string } };
    };
    const rollbackGeneration = rollbackRequest.change.profile.generation;
    expect(rollbackGeneration).not.toBe(candidateGeneration);
    await expect(call(rollbackGeneration)).resolves.toMatchObject({
      ok: true,
      value: "provider-result",
    });
    replacementResult(sender, rollbackRequest.requestId, true, rollbackGeneration);
    await rollback;
    await expect(call(candidateGeneration)).resolves.toMatchObject({ ok: false });
  });

  it("blocks the acknowledged generation in every renderer window", async () => {
    const first = rendererSender(43);
    const second = rendererSender(44);
    electronMock.fromId.mockImplementation((id) =>
      id === first.id ? first : id === second.id ? second : undefined,
    );
    const dispatch = vi.fn(async () => "provider-result");
    const host = new CapabilityIpcHost(
      {
        providerRuntime: {
          serviceProviders: () => [
            { name: "terminal.pty", providerId: "pty-native" },
          ],
        },
        dispatch,
      } as never,
      rendererProfile,
    );
    const profileHandler = electronMock.handlers.get(
      "termco:plugins:renderer-profile",
    );
    const firstProfile = profileHandler?.({ sender: first } as never) as {
      generation: string;
    };
    const secondProfile = profileHandler?.({ sender: second } as never) as {
      generation: string;
    };
    expect(secondProfile.generation).toBe(firstProfile.generation);

    const quiesce = host.quiesceRendererProfiles(
      rendererProfile,
      ["terminal-provider-row"],
      ["pty-native"],
    );
    const request = first.send.mock.calls[0]?.[1] as { requestId: string };
    replacementResult(first, request.requestId, true, firstProfile.generation);
    replacementResult(second, request.requestId, true, secondProfile.generation);
    await quiesce;

    const capabilityCall = electronMock.handlers.get("termco:services:call");
    for (const sender of [first, second]) {
      await expect(
        capabilityCall?.(
          { sender } as never,
          {
            consumerPluginId: "terminal-surface-native",
            capability: "terminal.pty",
            method: "write",
            args: [1, "pwd"],
            rendererGeneration: firstProfile.generation,
          } as never,
        ),
      ).resolves.toMatchObject({ ok: false });
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("publishes a pending generation to new windows and includes them in convergence", async () => {
    const first = rendererSender(45);
    const joined = rendererSender(46);
    electronMock.fromId.mockImplementation((id) =>
      id === first.id ? first : id === joined.id ? joined : undefined,
    );
    const dispatch = vi.fn(async () => "provider-result");
    const host = new CapabilityIpcHost(
      {
        providerRuntime: {
          serviceProviders: () => [
            {
              name: "company.remote",
              providerId: "candidate-provider",
            },
          ],
        },
        dispatch,
      } as never,
      rendererProfile,
    );
    const profileHandler = electronMock.handlers.get(
      "termco:plugins:renderer-profile",
    );
    const firstProfile = profileHandler?.({ sender: first } as never) as {
      generation: string;
    };

    const activation = host.replaceRendererProfiles(rendererProfile);
    const candidateRequest = first.send.mock.calls[0]?.[1] as {
      requestId: string;
      change: { profile: { generation: string } };
    };
    expect(candidateRequest.change.profile.generation).not.toBe(
      firstProfile.generation,
    );
    const joinedProfile = profileHandler?.({ sender: joined } as never) as {
      generation: string;
    };
    expect(joinedProfile.generation).toBe(
      candidateRequest.change.profile.generation,
    );
    replacementResult(
      first,
      candidateRequest.requestId,
      false,
      candidateRequest.change.profile.generation,
    );
    await expect(activation).rejects.toThrow("renderer failed");

    const capabilityCall = electronMock.handlers.get("termco:services:call");
    const callRemote = (generation: string) =>
      capabilityCall?.(
        { sender: first } as never,
        {
          consumerPluginId: "company-bridge",
          capability: "company.remote",
          method: "read",
          args: [],
          rendererGeneration: generation,
        } as never,
      );
    await expect(
      callRemote(candidateRequest.change.profile.generation),
    ).resolves.toMatchObject({ ok: true, value: "provider-result" });

    const quiesce = host.quiesceRendererProfiles(
      rendererProfile,
      ["candidate-provider-row"],
      ["candidate-provider"],
    );
    const firstQuiesce = first.send.mock.calls[1]?.[1] as {
      requestId: string;
      change: { profile: { generation: string } };
    };
    const joinedQuiesce = joined.send.mock.calls[0]?.[1] as {
      requestId: string;
      change: { profile: { generation: string } };
    };
    expect(firstQuiesce.change.profile.generation).toBe(
      candidateRequest.change.profile.generation,
    );
    expect(joinedQuiesce.change.profile.generation).toBe(
      joinedProfile.generation,
    );
    replacementResult(
      first,
      firstQuiesce.requestId,
      true,
      candidateRequest.change.profile.generation,
    );
    replacementResult(
      joined,
      joinedQuiesce.requestId,
      true,
      joinedProfile.generation,
    );
    await expect(quiesce).resolves.toBeUndefined();
    await expect(
      callRemote(candidateRequest.change.profile.generation),
    ).resolves.toMatchObject({ ok: false });

    const convergence = host.restoreRendererProfiles(rendererProfile);
    const firstRestore = first.send.mock.calls[2]?.[1] as {
      requestId: string;
      change: { profile: { generation: string } };
    };
    const joinedRestore = joined.send.mock.calls[1]?.[1] as {
      requestId: string;
    };
    expect(joinedRestore.requestId).toBe(firstRestore.requestId);
    replacementResult(
      first,
      firstRestore.requestId,
      true,
      firstRestore.change.profile.generation,
    );
    replacementResult(
      joined,
      joinedRestore.requestId,
      true,
      firstRestore.change.profile.generation,
    );
    await expect(convergence).resolves.toBeUndefined();
    await expect(
      callRemote(firstRestore.change.profile.generation),
    ).resolves.toMatchObject({ ok: true, value: "provider-result" });
  });

  it("restores every renderer after a partial multi-renderer quiesce failure", async () => {
    const first = rendererSender(41);
    const second = rendererSender(42);
    electronMock.fromId.mockImplementation((id) =>
      id === first.id ? first : id === second.id ? second : undefined,
    );
    const host = new CapabilityIpcHost({} as never, rendererProfile);
    const profileHandler = electronMock.handlers.get(
      "termco:plugins:renderer-profile",
    );
    profileHandler?.({ sender: first } as never);
    profileHandler?.({ sender: second } as never);

    const quiesce = host.quiesceRendererProfiles(
      rendererProfile,
      ["pty-native"],
      ["pty-native"],
    );
    const firstRequest = first.send.mock.calls[0]?.[1] as {
      requestId: string;
      change: { phase: string };
    };
    const secondRequest = second.send.mock.calls[0]?.[1] as {
      requestId: string;
    };
    expect(firstRequest.change.phase).toBe("quiesce");
    replacementResult(first, firstRequest.requestId, true);
    replacementResult(second, secondRequest.requestId, false);
    await expect(quiesce).rejects.toThrow("renderer failed");

    const convergence = host.restoreRendererProfiles(rendererProfile);
    const restoreRequest = first.send.mock.calls[1]?.[1] as {
      requestId: string;
      change: { phase: string };
    };
    expect(restoreRequest.requestId).not.toBe(firstRequest.requestId);
    expect(restoreRequest.change.phase).toBe("activate");
    replacementResult(first, restoreRequest.requestId, true);
    replacementResult(second, restoreRequest.requestId, true);
    await expect(convergence).resolves.toBeUndefined();
  });

  it("ignores a late timed-out acknowledgement and converges through a new request", async () => {
    vi.useFakeTimers();
    const sender = rendererSender(51);
    electronMock.fromId.mockReturnValue(sender);
    const host = new CapabilityIpcHost({} as never, rendererProfile);
    electronMock.handlers
      .get("termco:plugins:renderer-profile")
      ?.({ sender } as never);

    const quiesce = host.quiesceRendererProfiles(
      rendererProfile,
      ["events-native"],
      ["events-native"],
    );
    const timedOut = expect(quiesce).rejects.toThrow("timed out");
    const expired = sender.send.mock.calls[0]?.[1] as { requestId: string };
    await vi.advanceTimersByTimeAsync(15_000);
    await timedOut;
    replacementResult(sender, expired.requestId, true);

    const convergence = host.restoreRendererProfiles(rendererProfile);
    const restore = sender.send.mock.calls[1]?.[1] as { requestId: string };
    expect(restore.requestId).not.toBe(expired.requestId);
    replacementResult(sender, restore.requestId, true);
    await expect(convergence).resolves.toBeUndefined();
  });

  it("drains calls already dispatched by quiesced renderers before resolving", async () => {
    const sender = rendererSender(61);
    electronMock.fromId.mockReturnValue(sender);
    let finishCall = (_value: unknown) => {};
    const callGate = new Promise<unknown>((resolve) => {
      finishCall = resolve;
    });
    const host = new CapabilityIpcHost(
      {
        providerRuntime: {
          serviceProviders: () => [
            { name: "terminal.pty", providerId: "pty-native" },
          ],
        },
        dispatch: vi.fn(() => callGate),
      } as never,
      rendererProfile,
    );
    const initial = electronMock.handlers
      .get("termco:plugins:renderer-profile")
      ?.({ sender } as never) as { generation: string };
    const capabilityCall = electronMock.handlers.get(
      "termco:services:call",
    );
    const inFlight = capabilityCall?.(
      { sender } as never,
      {
        consumerPluginId: "terminal-surface-native",
        capability: "terminal.pty",
        method: "write",
        args: [1, "pwd"],
        rendererGeneration: initial.generation,
      } as never,
    );

    const quiesce = host.quiesceRendererProfiles(
      rendererProfile,
      ["pty-native"],
      ["pty-native"],
    );
    const request = sender.send.mock.calls[0]?.[1] as { requestId: string };
    replacementResult(sender, request.requestId, true);
    let settled = false;
    void quiesce.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    finishCall("written");
    await expect(quiesce).resolves.toBeUndefined();
    await expect(inFlight).resolves.toBeDefined();
  });

  it("drains only calls owned by affected main providers", async () => {
    const sender = rendererSender(62);
    electronMock.fromId.mockReturnValue(sender);
    let finishAffected = (_value: unknown) => {};
    let finishUnrelated = (_value: unknown) => {};
    const affectedGate = new Promise<unknown>((resolve) => {
      finishAffected = resolve;
    });
    const unrelatedGate = new Promise<unknown>((resolve) => {
      finishUnrelated = resolve;
    });
    const host = new CapabilityIpcHost(
      {
        providerRuntime: {
          serviceProviders: () => [
            { name: "terminal.pty", providerId: "pty-native" },
            { name: "ai.chat", providerId: "ai-native" },
          ],
        },
        dispatch: vi.fn((call: { capability: string }) =>
          call.capability === "terminal.pty" ? affectedGate : unrelatedGate,
        ),
      } as never,
      rendererProfile,
    );
    const initial = electronMock.handlers
      .get("termco:plugins:renderer-profile")
      ?.({ sender } as never) as { generation: string };
    const capabilityCall = electronMock.handlers.get(
      "termco:services:call",
    );
    const affectedCall = capabilityCall?.(
      { sender } as never,
      {
        consumerPluginId: "terminal-surface-native",
        capability: "terminal.pty",
        method: "write",
        args: [1, "pwd"],
        rendererGeneration: initial.generation,
      } as never,
    );
    const unrelatedCall = capabilityCall?.(
      { sender } as never,
      {
        consumerPluginId: "ai-chat-native",
        capability: "ai.chat",
        method: "complete",
        args: [],
        rendererGeneration: initial.generation,
      } as never,
    );

    const quiesce = host.quiesceRendererProfiles(
      rendererProfile,
      ["terminal-provider-row"],
      ["pty-native"],
      ["terminal.pty"],
    );
    const request = sender.send.mock.calls[0]?.[1] as {
      requestId: string;
      change: { changedPluginIds: string[]; changedServiceNames: string[] };
    };
    expect(request.change.changedPluginIds).toEqual(["terminal-provider-row"]);
    expect(request.change.changedServiceNames).toEqual(["terminal.pty"]);
    replacementResult(sender, request.requestId, true);
    finishAffected("written");
    const result = await Promise.race([
      quiesce.then(() => "quiesced"),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve("blocked by unrelated call"), 20),
      ),
    ]);

    finishUnrelated("completed");
    await Promise.all([affectedCall, unrelatedCall]);
    expect(result).toBe("quiesced");
  });

  it("rejects newly queued affected calls until renderer activation converges", async () => {
    const sender = rendererSender(63);
    electronMock.fromId.mockReturnValue(sender);
    const dispatch = vi.fn(async (call: { capability: string }) =>
      `${call.capability}:result`,
    );
    const host = new CapabilityIpcHost(
      {
        providerRuntime: {
          serviceProviders: () => [
            { name: "terminal.pty", providerId: "pty-native" },
            { name: "ai.chat", providerId: "ai-native" },
          ],
        },
        dispatch,
      } as never,
      rendererProfile,
    );
    const initial = electronMock.handlers
      .get("termco:plugins:renderer-profile")
      ?.({ sender } as never) as { generation: string };
    const capabilityCall = electronMock.handlers.get(
      "termco:services:call",
    );

    const quiesce = host.quiesceRendererProfiles(
      rendererProfile,
      ["terminal-provider-row"],
      ["pty-native"],
    );
    const quiesceRequest = sender.send.mock.calls[0]?.[1] as {
      requestId: string;
    };
    replacementResult(sender, quiesceRequest.requestId, true);
    await quiesce;

    const affectedWhileQuiesced = await capabilityCall?.(
      { sender } as never,
      {
        consumerPluginId: "terminal-surface-native",
        capability: "terminal.pty",
        method: "write",
        args: [1, "pwd"],
        rendererGeneration: initial.generation,
      } as never,
    );
    expect(affectedWhileQuiesced).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("pty-native") },
    });
    expect(dispatch).not.toHaveBeenCalled();

    await expect(
      capabilityCall?.(
        { sender } as never,
        {
          consumerPluginId: "ai-chat-native",
          capability: "ai.chat",
          method: "complete",
          args: [],
          rendererGeneration: initial.generation,
        } as never,
      ),
    ).resolves.toMatchObject({ ok: true, value: "ai.chat:result" });
    expect(dispatch).toHaveBeenCalledOnce();

    const activate = host.replaceRendererProfiles(rendererProfile);
    const activateRequest = sender.send.mock.calls[1]?.[1] as {
      requestId: string;
      change: { profile: { generation: string } };
    };
    replacementResult(sender, activateRequest.requestId, true);
    await activate;
    await expect(
      capabilityCall?.(
        { sender } as never,
        {
          consumerPluginId: "terminal-surface-native",
          capability: "terminal.pty",
          method: "write",
          args: [1, "pwd"],
          rendererGeneration: activateRequest.change.profile.generation,
        } as never,
      ),
    ).resolves.toMatchObject({ ok: true, value: "terminal.pty:result" });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});

describe("remote disposer ownership", () => {
  it("unsubscribes exactly once when a bridge releases its handle", async () => {
    const registry = new RemoteDisposerRegistry();
    const dispose = vi.fn();
    const handle = registry.register(41, "company-bridge", dispose);

    await registry.release(41, "company-bridge", handle);
    await registry.release(41, "company-bridge", handle);

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("cleans only the destroyed sender's remaining handles", async () => {
    const registry = new RemoteDisposerRegistry();
    const first = vi.fn();
    const second = vi.fn();
    registry.register(41, "company-bridge", first);
    registry.register(42, "company-bridge", second);

    await registry.releaseSender(41);

    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    await registry.releaseSender(42);
    expect(second).toHaveBeenCalledOnce();
  });

  it("rejects handles released by another sender or bridge Fiber", async () => {
    const registry = new RemoteDisposerRegistry();
    const dispose = vi.fn();
    const handle = registry.register(41, "company-bridge", dispose);

    await expect(
      registry.release(42, "company-bridge", handle),
    ).rejects.toThrow(/does not belong/);
    await expect(
      registry.release(41, "other-bridge", handle),
    ).rejects.toThrow(/does not belong/);
    expect(dispose).not.toHaveBeenCalled();

    await registry.release(41, "company-bridge", handle);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("propagates provider cleanup errors after invalidating the handle", async () => {
    const registry = new RemoteDisposerRegistry();
    const handle = registry.register(41, "company-bridge", () => {
      throw new Error("provider unsubscribe failed");
    });

    await expect(
      registry.release(41, "company-bridge", handle),
    ).rejects.toThrow("provider unsubscribe failed");
    await expect(
      registry.release(41, "company-bridge", handle),
    ).resolves.toBeUndefined();
  });
});

describe("capability caller projection", () => {
  it("appends trusted current-window identity to desktop control calls", () => {
    const call = attachAuthenticatedCaller(
      {
        consumerPluginId: "desktop-native",
        capability: "desktop.window-control",
        method: "setTitle",
        args: ["Project — src"],
        caller: true,
        callerFields: {
          eventSink: { __termcoChannel: 19 },
          senderWebContentsId: 999,
          windowId: 999,
          windowLabel: "spoofed",
        },
      },
      41,
      7,
      "main",
    );

    expect(call.args).toEqual([
      "Project — src",
      {
        eventSink: { __termcoChannel: 19 },
        senderWebContentsId: 41,
        windowId: 7,
        windowLabel: "main",
      },
    ]);
  });

  it("materializes family-selected callback markers without service knowledge", () => {
    const send = vi.fn();
    const sender = { isDestroyed: () => false, send } as never;
    const call = attachRendererChannels(
      {
        consumerPluginId: "company-bridge",
        capability: "company.stream",
        method: "subscribe",
        args: [{ nested: [{ __termcoChannel: 17 }] }],
      },
      sender,
    );
    const callback = (
      call.args[0] as { nested: Array<(value: unknown) => void> }
    ).nested[0];
    callback?.("update");
    expect(send).toHaveBeenCalledWith("termco:channel", 17, {
      __termcoChannelArgs: ["update"],
    });
  });

  it("does not add renderer identity to unrelated capability methods", () => {
    const call = {
      consumerPluginId: "files-native",
      capability: "workspace.files",
      method: "readText",
      args: ["/work/file.ts"],
    };
    expect(attachAuthenticatedCaller(call, 41, 7, "main")).toEqual(call);
  });
});
