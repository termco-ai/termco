import type { ProfilePluginRowV3 } from "../../../src/platform/contracts";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getAppPath: vi.fn(() => process.cwd()),
    getPath: vi.fn(() => process.cwd()),
    isPackaged: false,
  },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: { showMessageBox: vi.fn(), showOpenDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  shell: { openPath: vi.fn(), trashItem: vi.fn() },
  webContents: { fromId: vi.fn() },
}));

let replaceProfileRow: typeof import("./pluginRuntime").replaceProfileRow;
let releaseReplacementProfileRows: typeof import("./pluginRuntime").releaseReplacementProfileRows;
let mergeGeneratedUserProfileDefaults: typeof import("./pluginRuntime").mergeGeneratedUserProfileDefaults;
let repairOrphanedReplacementRows: typeof import("./pluginRuntime").repairOrphanedReplacementRows;
let removeMissingManagedPluginRows: typeof import("./pluginRuntime").removeMissingManagedPluginRows;
let profileRowsAfterUninstall: typeof import("./pluginRuntime").profileRowsAfterUninstall;
let profileRowsWithEnabled: typeof import("./pluginRuntime").profileRowsWithEnabled;
let recordProfileBootFailure: typeof import("./pluginRuntime").recordProfileBootFailure;
let serializeReplacementTransaction: typeof import("./pluginRuntime").serializeReplacementTransaction;
let runForwardReplacement: typeof import("./pluginRuntime").runForwardReplacement;
let runBackwardReplacement: typeof import("./pluginRuntime").runBackwardReplacement;
let replacementPluginScopes: typeof import("./pluginRuntime").replacementPluginScopes;
let planPlugin: typeof import("./pluginRuntime").planPlugin;
let plannedMutation: typeof import("./pluginRuntime").plannedMutation;
let snapshotProfile: typeof import("./pluginRuntime").snapshotProfile;

beforeAll(async () => {
  ({
    replaceProfileRow,
    releaseReplacementProfileRows,
    mergeGeneratedUserProfileDefaults,
    repairOrphanedReplacementRows,
    removeMissingManagedPluginRows,
    profileRowsAfterUninstall,
    profileRowsWithEnabled,
    recordProfileBootFailure,
    serializeReplacementTransaction,
    runForwardReplacement,
    runBackwardReplacement,
    replacementPluginScopes,
    planPlugin,
    plannedMutation,
    snapshotProfile,
  } = await import("./pluginRuntime"));
});

describe("plugin completion transactions", () => {
  it("snapshots only strict-v3 profile fields for Undo", () => {
    const snapshot = snapshotProfile({
      schemaVersion: 3,
      id: "test.profile",
      bundles: [],
      plugins: [{ id: "test-plugin", module: "./test-plugin" }],
      patches: [],
      provenance: { "test-plugin": "test.profile" },
      layers: ["test.profile"],
    } as never);

    expect(snapshot).toEqual({
      schemaVersion: 3,
      id: "test.profile",
      bundles: [],
      plugins: [{ id: "test-plugin", module: "./test-plugin" }],
      patches: [],
    });
    expect(snapshot).not.toHaveProperty("provenance");
    expect(snapshot).not.toHaveProperty("layers");
  });
});

describe("missing managed plugin reconciliation", () => {
  it("removes active and inactive missing managed rows and restores their originals", () => {
    const managedRoot = "/managed/plugins";
    const profile = {
      schemaVersion: 3 as const,
      id: "termco.user.2000.bbbbbbbb",
      bundles: [],
      plugins: [
        { id: "original", module: "bundled:plugin-repository/plugins/original", enabled: false, disabledBy: "missing-replacement" },
        { id: "missing-replacement", module: `${managedRoot}/missing-replacement` },
        { id: "missing-fork", module: `${managedRoot}/missing-fork`, enabled: false },
        { id: "present", module: `${managedRoot}/present` },
      ],
      patches: [],
    };

    expect(removeMissingManagedPluginRows(
      profile,
      managedRoot,
      new Set([
        `${managedRoot}/missing-replacement`,
        `${managedRoot}/missing-fork`,
      ]),
    )).toEqual({
      profile: {
        ...profile,
        plugins: [
          { id: "original", module: "bundled:plugin-repository/plugins/original" },
          { id: "present", module: `${managedRoot}/present` },
        ],
      },
      removedPluginIds: ["missing-replacement", "missing-fork"],
      restoredPluginIds: ["original"],
    });
  });

  it("never removes bundled, package, nested, or external source rows", () => {
    const managedRoot = "/managed/plugins";
    const profile = {
      schemaVersion: 3 as const,
      id: "termco.user.2000.bbbbbbbb",
      bundles: [],
      plugins: [
        { id: "bundled", module: "bundled:plugin-repository/plugins/bundled" },
        { id: "package", module: "@company/plugin" },
        { id: "external", module: "/elsewhere/external" },
        { id: "nested", module: `${managedRoot}/nested/source` },
      ],
      patches: [],
    };
    const missing = new Set(profile.plugins.map((row) => row.module));

    expect(removeMissingManagedPluginRows(profile, managedRoot, missing)).toEqual({
      profile,
      removedPluginIds: [],
      restoredPluginIds: [],
    });
  });

  it("is idempotent after the stale rows are gone", () => {
    const profile = {
      schemaVersion: 3 as const,
      id: "termco.user.2000.bbbbbbbb",
      bundles: [],
      plugins: [{ id: "missing", module: "/managed/plugins/missing" }],
      patches: [],
    };
    const repaired = removeMissingManagedPluginRows(
      profile,
      "/managed/plugins",
      new Set(["/managed/plugins/missing"]),
    );
    expect(removeMissingManagedPluginRows(
      repaired.profile,
      "/managed/plugins",
      new Set(["/managed/plugins/missing"]),
    )).toEqual({
      profile: repaired.profile,
      removedPluginIds: [],
      restoredPluginIds: [],
    });
  });
});

describe("main-process plugin authoring plans", () => {
  it("freezes a valid onboarding decision at the IPC boundary", () => {
    const onboarding = {
      decision: "include" as const,
      rationale: "The visible workflow is new.",
      journey: {
        id: "calculator-fab-getting-started",
        title: "Try Calculator",
        description: "Open the calculator.",
        presentation: "contextual" as const,
        steps: [{ id: "open", version: 1, title: "Open", kind: "interaction", instruction: "Open it.", targetId: "calculator", expectation: { kind: "click" } }],
      },
    };
    const plan = planPlugin({
      intent: "create",
      plugin: { id: "calculator-onboarding", name: "Calculator", description: "Calculator.", category: "Interface" },
      target: "ui.overlays",
      contributions: [],
      reveal: "auto",
      onboarding,
    });
    onboarding.journey.title = "Mutated later";

    expect(plan.onboarding).toMatchObject({
      decision: "include",
      journey: { title: "Try Calculator" },
    });
    expect(() => planPlugin({
      ...plan,
      plugin: { ...plan.plugin, id: "automatic-onboarding" },
      onboarding: {
        ...onboarding,
        journey: { ...onboarding.journey, presentation: "automatic" },
      },
    })).toThrow("onboarding plan is invalid");
  });

  it("binds one immutable intent and rejects reuse", () => {
    const plan = planPlugin({
      intent: "create",
      plugin: {
        id: "calculator-fab",
        name: "Calculator FAB",
        description: "Floating calculator.",
        category: "Interface",
      },
      target: "ui.overlays",
      contributions: [{
        contribution: { service: "ui.overlays", key: "calculator-fab" },
        present: true,
      }],
      reveal: "auto",
    });

    expect(() => plannedMutation(plan.planId, "fork")).toThrow(
      `is create, not fork`,
    );
    const mutation = plannedMutation(plan.planId, "create");
    expect(mutation.plan).toEqual(plan);
    mutation.markUsed();
    expect(() => plannedMutation(plan.planId, "create")).toThrow("was already used");
  });

  it("validates source ids for fork and replacement plans through the shared rule", () => {
    for (const intent of ["fork", "replace"] as const) {
      const plan = planPlugin({
        intent,
        plugin: {
          id: `planned-${intent}`,
          name: `Planned ${intent}`,
          description: `Exercises the ${intent} source-id boundary.`,
          category: "Testing",
        },
        sourcePluginId: "source-plugin",
        target: "renderer-provider",
        contributions: [],
        reveal: "none",
      });
      expect(plannedMutation(plan.planId, intent).plan.sourcePluginId).toBe(
        "source-plugin",
      );
    }
  });
});

describe("two-phase process replacement", () => {
  it("projects affected main services without broadening renderer row roots", () => {
    const runtime = {
      dependencyClosedPluginIds: vi.fn(() =>
        new Set([
          "events-native",
          "pty-native",
          "ai-library-native",
        ]),
      ),
      serviceProviders: () => [
        { name: "events.application", providerId: "events-native" },
        { name: "terminal.pty", providerId: "pty-native" },
        { name: "ai.library", providerId: "ai-library-native" },
        { name: "storage.application", providerId: "storage-json" },
      ],
    };

    expect(
      replacementPluginScopes(runtime as never, new Set(["events-native"])),
    ).toEqual({
      rendererChangedPluginIds: ["events-native"],
      rendererChangedServiceNames: [
        "events.application",
        "terminal.pty",
        "ai.library",
      ],
      drainProviderPluginIds: [
        "events-native",
        "pty-native",
        "ai-library-native",
      ],
    });
  });

  it("projects PTY service impact from the SSH main dependency closure", () => {
    const runtime = {
      dependencyClosedPluginIds: vi.fn(() =>
        new Set(["ssh-native", "pty-native", "terminal-surface-native"]),
      ),
      serviceProviders: () => [
        { name: "ssh.client", providerId: "ssh-native" },
        { name: "terminal.pty", providerId: "pty-native" },
        {
          name: "ui.terminal-surface",
          providerId: "terminal-surface-native",
        },
        { name: "events.application", providerId: "events-native" },
      ],
    };

    expect(
      replacementPluginScopes(runtime as never, new Set(["ssh-native"])),
    ).toEqual({
      rendererChangedPluginIds: ["ssh-native"],
      rendererChangedServiceNames: [
        "ssh.client",
        "terminal.pty",
        "ui.terminal-surface",
      ],
      drainProviderPluginIds: [
        "ssh-native",
        "pty-native",
        "terminal-surface-native",
      ],
    });
  });

  it("quiesces renderer consumers before destructive main replacement", async () => {
    const order: string[] = [];

    await runForwardReplacement({
      async replaceMain(beforeDeactivate) {
        order.push("main:prepared");
        await beforeDeactivate();
        order.push("main:deactivated");
        return undefined;
      },
      async quiesceRenderer() {
        order.push("renderer:quiesced");
      },
      async restorePreviousRenderer() {
        order.push("renderer:restored");
      },
    });

    expect(order).toEqual([
      "main:prepared",
      "renderer:quiesced",
      "main:deactivated",
    ]);
  });

  it("converges previous renderers after any quiesce attempt fails", async () => {
    const order: string[] = [];

    await expect(
      runForwardReplacement({
        async replaceMain(beforeDeactivate) {
          await beforeDeactivate();
        },
        async quiesceRenderer() {
          order.push("renderer:partial-quiesce");
          throw new Error("second renderer failed");
        },
        async restorePreviousRenderer() {
          order.push("renderer:previous-restored");
        },
      }),
    ).rejects.toThrow("second renderer failed");

    expect(order).toEqual([
      "renderer:partial-quiesce",
      "renderer:previous-restored",
    ]);
  });

  it("preserves both causes when main failure and renderer convergence fail", async () => {
    await expect(
      runForwardReplacement({
        async replaceMain(beforeDeactivate) {
          await beforeDeactivate();
          throw new Error("main provider activation failed");
        },
        async quiesceRenderer() {},
        async restorePreviousRenderer() {
          throw new Error("previous renderer activation failed");
        },
      }),
    ).rejects.toThrow(
      /main provider activation failed.*previous renderer activation failed/,
    );
  });

  it("quiesces candidate renderers before restoring main and the previous renderer", async () => {
    const order: string[] = [];

    await runBackwardReplacement({
      async quiesceCandidateRenderer() {
        order.push("candidate-renderer:quiesced");
      },
      async restoreCandidateRenderer() {
        order.push("candidate-renderer:restored");
      },
      async restoreMain() {
        order.push("main:previous-restored");
      },
      installPreviousRouter() {
        order.push("router:previous");
      },
      async activatePreviousRenderer() {
        order.push("previous-renderer:active");
      },
    });

    expect(order).toEqual([
      "candidate-renderer:quiesced",
      "main:previous-restored",
      "router:previous",
      "previous-renderer:active",
    ]);
  });

  it("re-converges candidate renderers when backward main restoration fails", async () => {
    const order: string[] = [];

    await expect(
      runBackwardReplacement({
        async quiesceCandidateRenderer() {
          order.push("candidate-renderer:quiesced");
        },
        async restoreCandidateRenderer() {
          order.push("candidate-renderer:restored");
        },
        async restoreMain() {
          order.push("main:restore-failed");
          throw new Error("main rollback failed");
        },
        installPreviousRouter() {
          order.push("router:previous");
        },
        async activatePreviousRenderer() {
          order.push("previous-renderer:active");
        },
      }),
    ).rejects.toThrow("main rollback failed");

    expect(order).toEqual([
      "candidate-renderer:quiesced",
      "main:restore-failed",
      "candidate-renderer:restored",
    ]);
  });
});

describe("live replacement serialization", () => {
  it("does not start a second replacement before the first settles", async () => {
    const order: string[] = [];
    let releaseFirst = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = serializeReplacementTransaction(async () => {
      order.push("first:start");
      await firstGate;
      order.push("first:end");
      return "first";
    });
    const second = serializeReplacementTransaction(async () => {
      order.push("second:start");
      return "second";
    });

    await vi.waitFor(() => expect(order).toEqual(["first:start"]));
    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toEqual([
      "first",
      "second",
    ]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });
});

describe("safe profile boot diagnostics", () => {
  it("records the failed and recovery profiles through the selected provider", async () => {
    const runtime = { callCapability: vi.fn(async () => undefined) };

    await recordProfileBootFailure(
      runtime as never,
      "broken.user",
      new Error("missing plugin"),
      "2026-08-22T06:30:00.000Z",
    );

    expect(runtime.callCapability).toHaveBeenCalledExactlyOnceWith(
      "application.boot-diagnostics",
      "record",
      [
        {
          requestedProfileId: "broken.user",
          recoveryProfileId: "termco.safe-recovery",
          phase: "profile-boot",
          message: "Error: missing plugin",
          at: "2026-08-22T06:30:00.000Z",
        },
      ],
    );
  });
});

describe("live plugin profile rows", () => {
  const original: ProfilePluginRowV3 = {
    id: "agents-manager-native",
    module: "file:///original/agents-manager-native",
  };
  const neighbor: ProfilePluginRowV3 = {
    id: "header-native",
    module: "bundled:plugin-repository/plugins/header-native",
  };

  it("adds newly shipped defaults without losing disabled or user-installed rows", () => {
    const defaults = {
      schemaVersion: 3 as const,
      id: "termco.default",
      bundles: [],
      plugins: [
        original,
        { id: "file-icons-native", module: "bundled:plugin-repository/plugins/file-icons-native" },
        neighbor,
      ],
      patches: [],
    };
    const userPlugin: ProfilePluginRowV3 = {
      id: "company.notes",
      module: "/tmp/company.notes",
    };
    const migrated = mergeGeneratedUserProfileDefaults(
      {
        ...defaults,
        id: "termco.user.1787426858912.40049196",
        plugins: [{ ...original, enabled: false }, neighbor, userPlugin],
      },
      defaults,
    );

    expect(migrated.addedPluginIds).toEqual(["file-icons-native"]);
    expect(migrated.profile.plugins).toEqual([
      { ...original, enabled: false },
      { id: "file-icons-native", module: "bundled:plugin-repository/plugins/file-icons-native" },
      neighbor,
      userPlugin,
    ]);
  });

  it("repairs a legacy profile that removed a replacement but stranded its source disabled", () => {
    const selection: ProfilePluginRowV3 = {
      id: "selection-ask-ai-native",
      module: "bundled:plugin-repository/plugins/selection-ask-ai-native",
      enabled: false,
    };
    const calculator: ProfilePluginRowV3 = {
      id: "calculator-fab",
      module: "/managed/plugins/calculator-fab",
    };
    const previous = {
      schemaVersion: 3 as const,
      id: "termco.user.1000.aaaaaaaa",
      bundles: [],
      plugins: [selection, calculator, neighbor],
      patches: [],
    };
    const current = {
      ...previous,
      id: "termco.user.2000.bbbbbbbb",
      plugins: [selection, neighbor],
    };

    expect(
      repairOrphanedReplacementRows(
        current,
        previous,
        "/managed/plugins",
      ),
    ).toEqual({
      profile: {
        ...current,
        plugins: [
          {
            id: "selection-ask-ai-native",
            module: "bundled:plugin-repository/plugins/selection-ask-ai-native",
          },
          neighbor,
        ],
      },
      restoredPluginIds: ["selection-ask-ai-native"],
    });
  });

  it("restores the exact original row when a copied replacement is uninstalled", () => {
    const selected = replaceProfileRow(
      [original, neighbor],
      original.id,
      "e2e.agents-manager-native",
      "/tmp/e2e.agents-manager-native",
    );
    expect(selected).toEqual([
      {
        ...original,
        enabled: false,
        disabledBy: "e2e.agents-manager-native",
      },
      {
        id: "e2e.agents-manager-native",
        module: "/tmp/e2e.agents-manager-native",
      },
      neighbor,
    ]);

    expect(
      profileRowsAfterUninstall(selected, {
        id: "e2e.agents-manager-native",
        replaces: original.id,
      }),
    ).toEqual([original, neighbor]);
  });

  it("restores the source row when an edited replacement becomes independent", () => {
    const selected = replaceProfileRow(
      [original, neighbor],
      original.id,
      "calculator-fab",
      "/tmp/calculator-fab",
    );
    expect(
      releaseReplacementProfileRows(
        selected,
        "calculator-fab",
        original.id,
      ),
    ).toEqual([
      original,
      { id: "calculator-fab", module: "/tmp/calculator-fab" },
      neighbor,
    ]);
  });

  it("restores a replacement-owned source row even after replaces was removed", () => {
    const selected = replaceProfileRow(
      [original, neighbor],
      original.id,
      "calculator-fab",
      "/tmp/calculator-fab",
    );
    expect(
      profileRowsAfterUninstall(selected, { id: "calculator-fab" }),
    ).toEqual([original, neighbor]);
  });

  it("removes an ordinary user plugin without manufacturing a replacement", () => {
    const userPlugin: ProfilePluginRowV3 = {
      id: "company.notes",
      module: "/tmp/company.notes",
    };

    expect(
      profileRowsAfterUninstall([original, userPlugin, neighbor], {
        id: userPlugin.id,
      }),
    ).toEqual([original, neighbor]);
  });

  it("preserves disabled profile rows so activation is reversible", () => {
    const disabled = profileRowsWithEnabled(
      [original, neighbor],
      original.id,
      false,
    );
    expect(disabled).toEqual([{ ...original, enabled: false }, neighbor]);
    expect(profileRowsWithEnabled(disabled, original.id, true)).toEqual([
      original,
      neighbor,
    ]);
  });
});
