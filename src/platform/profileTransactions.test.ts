import { describe, expect, it, vi } from "vitest";
import type { ProfilePluginRowV3, TermcoProfileV3 } from "./contracts";
import {
  PluginEnablePreviewRegistry,
  ProfileTransactionManager,
} from "./profileTransactions";

const row = (
  id: string,
  module = `@termco-plugin/${id}`,
): ProfilePluginRowV3 => ({ id, module });

function profile(
  id: string,
  plugins: ProfilePluginRowV3[] = [],
): TermcoProfileV3 {
  return {
    schemaVersion: 3,
    id,
    bundles: [],
    plugins,
    patches: [],
  };
}

describe("ProfileTransactionManager", () => {
  it("commits one stable-row replacement as one revision", async () => {
    const active = profile("default.profile", [
      row("ssh-runtime", "@termco/ssh-native"),
    ]);
    const manager = new ProfileTransactionManager({
      activeProfileId: active.id,
      profiles: new Map([[active.id, active]]),
    });
    const candidate = profile(active.id, [
      row("ssh-runtime", "@company/ssh-provider"),
    ]);
    const commit = vi.fn(async () => {});

    expect(manager.preview({ actor: "plugin-manager", profile: candidate }))
      .toMatchObject({ changedPlugins: ["ssh-runtime"] });
    const snapshot = await manager.apply(
      { actor: "plugin-manager", profile: candidate },
      commit,
    );

    expect(snapshot).toMatchObject({
      revision: 2,
      profile: { plugins: candidate.plugins },
    });
    expect(commit).toHaveBeenCalledOnce();
  });

  it("does not expose a candidate when candidate activation or persistence fails", async () => {
    const active = profile("default.profile", [row("ssh-runtime")]);
    const manager = new ProfileTransactionManager({
      activeProfileId: active.id,
      profiles: new Map([[active.id, active]]),
    });
    const candidate = profile(active.id, [
      row("ssh-runtime", "@company/ssh-provider"),
    ]);

    await expect(
      manager.apply(
        { actor: "profile-editor", profile: candidate },
        async () => {
          throw new Error("candidate activation failed");
        },
      ),
    ).rejects.toThrow("candidate activation failed");
    expect(manager.active).toMatchObject({
      revision: 1,
      profile: { plugins: active.plugins },
    });
  });

  it("reports inserted, removed, disabled, and source-changed row ids", () => {
    const active = profile("default.profile", [
      row("removed"),
      row("disabled"),
      row("replaced", "@termco/replaced"),
    ]);
    const manager = new ProfileTransactionManager({
      activeProfileId: active.id,
      profiles: new Map([[active.id, active]]),
    });
    const candidate = profile(active.id, [
      { ...row("disabled"), enabled: false },
      row("replaced", "@company/replaced"),
      row("inserted"),
    ]);

    expect(
      manager.preview({ actor: "profile-editor", profile: candidate })
        .changedPlugins,
    ).toEqual(["disabled", "inserted", "removed", "replaced"]);
    expect(manager.active.revision).toBe(1);
  });

  it("notifies subscribers only after the candidate commits", async () => {
    const active = profile("default.profile", [row("ssh-runtime")]);
    const manager = new ProfileTransactionManager({
      activeProfileId: active.id,
      profiles: new Map([[active.id, active]]),
    });
    const listener = vi.fn();
    const dispose = manager.subscribe(listener);
    const candidate = profile(active.id, [
      row("ssh-runtime", "@company/ssh-provider"),
    ]);

    await manager.apply(
      { actor: "profile-editor", profile: candidate },
      async (_request, preview) => {
        expect(listener).not.toHaveBeenCalled();
        expect(preview.candidate.revision).toBe(2);
      },
    );
    expect(listener).toHaveBeenCalledOnce();
    dispose();
  });
});

describe("PluginEnablePreviewRegistry", () => {
  it("accepts one exact current preview and rejects reuse", () => {
    const registry = new PluginEnablePreviewRegistry();
    const confirmation = registry.issue("git-native", false, "preview-1");

    expect(() =>
      registry.consume("git-native", false, confirmation),
    ).not.toThrow();
    expect(() =>
      registry.consume("git-native", false, confirmation),
    ).toThrow(/stale/);
  });

  it("rejects a preview after any committed graph generation", () => {
    const registry = new PluginEnablePreviewRegistry();
    const confirmation = registry.issue("git-native", false, "preview-1");
    registry.advance();

    expect(() =>
      registry.consume("git-native", false, confirmation),
    ).toThrow(/stale/);
  });

  it("does not authorize a different target or desired state", () => {
    const registry = new PluginEnablePreviewRegistry();
    const confirmation = registry.issue("git-native", false, "preview-1");

    expect(() =>
      registry.consume("workflows-native", false, confirmation),
    ).toThrow(/stale/);
    expect(() =>
      registry.consume("git-native", true, confirmation),
    ).toThrow(/stale/);
  });
});
