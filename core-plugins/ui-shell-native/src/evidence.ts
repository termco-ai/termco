import type {
  UiContributionCapability,
  UiContributionEvidenceCapability,
  UiContributionRef,
  UiContributionVerificationReport,
  UiContributionVerificationStage,
  UiVisibleTargetExpectation,
} from "@termco/ui-shell-base";
import type { UiShellContributionStore } from "./registry";
import { UI_CONTRIBUTION_CAPABILITIES } from "./shell";

function refs(store: UiShellContributionStore): UiContributionRef[] {
  return UI_CONTRIBUTION_CAPABILITIES.flatMap((service) =>
    store.entries(service).map((record) => ({
      service,
      pluginId: record.pluginId,
      generation: record.generation,
      key: record.key,
      contributionId: record.value.id,
    })),
  );
}

function semanticRole(element: HTMLElement): string | null {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;
  const tag = element.tagName.toLocaleLowerCase();
  if (tag === "button") return "button";
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "a" && element.hasAttribute("href")) return "link";
  if (tag === "input" || tag === "textarea") return "textbox";
  return null;
}

function accessibleName(element: HTMLElement): string {
  return (
    element.getAttribute("aria-label") ??
    element.getAttribute("title") ??
    element.textContent ??
    ""
  ).trim();
}

function isVisible(element: HTMLElement, documentRef: Document): boolean {
  if (!element.isConnected || element.hidden) return false;
  const view = documentRef.defaultView;
  const style = view?.getComputedStyle(element);
  if (
    style?.display === "none" ||
    style?.visibility === "hidden" ||
    style?.opacity === "0" ||
    style?.pointerEvents === "none"
  ) return false;
  const rect = element.getBoundingClientRect();
  const isJsdom = view?.navigator.userAgent.toLocaleLowerCase().includes("jsdom");
  if (!isJsdom && (rect.width <= 0 || rect.height <= 0)) return false;
  return true;
}

function ownedRoots(
  documentRef: Document,
  input: {
    pluginId: string;
    generation: string;
    service: UiContributionCapability;
    key: string;
  },
): HTMLElement[] {
  return [...documentRef.querySelectorAll<HTMLElement>("[data-plugin-owner]")]
    .filter((element) =>
      element.dataset.pluginOwner === input.pluginId &&
      element.dataset.pluginGeneration === input.generation &&
      element.dataset.contributionService === input.service &&
      element.dataset.contributionKey === input.key
    );
}

function semanticTargets(
  roots: readonly HTMLElement[],
  expectation: UiVisibleTargetExpectation,
): HTMLElement[] {
  const candidates = roots.flatMap((root) => [
    root,
    ...root.querySelectorAll<HTMLElement>("*"),
  ]);
  return [...new Set(candidates)].filter((element) =>
    semanticRole(element) === expectation.role &&
    accessibleName(element) === expectation.name
  );
}

function failure(
  input: { pluginId: string; generation: string },
  foundRefs: readonly UiContributionRef[],
  stages: ReadonlySet<UiContributionVerificationStage>,
  failedStage: UiContributionVerificationStage,
  message: string,
): UiContributionVerificationReport {
  return {
    ok: false,
    pluginId: input.pluginId,
    generation: input.generation,
    refs: foundRefs,
    completedStages: [...stages],
    failedStage,
    message,
  };
}

async function settleInteraction(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function observePostcondition(
  documentRef: Document,
  satisfied: () => boolean,
): Promise<boolean> {
  if (satisfied()) return true;
  const Observer = documentRef.defaultView?.MutationObserver;
  if (!Observer) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return satisfied();
  }
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      observer.disconnect();
      resolve(result);
    };
    const observer = new Observer(() => {
      if (satisfied()) finish(true);
    });
    const timeout = setTimeout(() => finish(satisfied()), 1_000);
    observer.observe(documentRef.documentElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    queueMicrotask(() => {
      if (satisfied()) finish(true);
    });
  });
}

export function createContributionEvidence(
  store: UiShellContributionStore,
  documentRef: Document,
): UiContributionEvidenceCapability {
  return {
    snapshot: () => refs(store),
    subscribe: (listener) => store.subscribe(listener),
    async verify(input) {
      const completed = new Set<UiContributionVerificationStage>();
      const foundRefs: UiContributionRef[] = [];

      for (const expectation of input.expectations) {
        const contribution = refs(store).find((candidate) =>
          candidate.pluginId === input.pluginId &&
          candidate.generation === input.generation &&
          candidate.service === expectation.contribution.service &&
          candidate.key === expectation.contribution.key
        );
        if (!contribution) {
          return failure(
            input,
            foundRefs,
            completed,
            "contribution-registered",
            `No ${expectation.contribution.service} contribution owned by ` +
              `"${input.pluginId}" generation "${input.generation}" uses key ` +
              `"${expectation.contribution.key}".`,
          );
        }
        foundRefs.push(contribution);
        completed.add("contribution-registered");

        const roots = ownedRoots(documentRef, {
          pluginId: input.pluginId,
          generation: input.generation,
          service: expectation.contribution.service,
          key: expectation.contribution.key,
        });
        if (expectation.visibleTarget && roots.length === 0) {
          return failure(
            input,
            foundRefs,
            completed,
            "surface-mounted",
            `The owned contribution is registered but its surface target is not mounted.`,
          );
        }
        if (roots.length > 0) completed.add("surface-mounted");

        let target: HTMLElement | undefined;
        if (expectation.visibleTarget) {
          target = semanticTargets(roots, expectation.visibleTarget).find((element) =>
            isVisible(element, documentRef)
          );
          if (!target) {
            return failure(
              input,
              foundRefs,
              completed,
              "visible-target",
              `The owned contribution has no visible ${expectation.visibleTarget.role} ` +
                `named "${expectation.visibleTarget.name}".`,
            );
          }
          const disabled = target.matches(":disabled") ||
            target.getAttribute("aria-disabled") === "true";
          if (disabled) {
            return failure(
              input,
              foundRefs,
              completed,
              "visible-target",
              `The owned target is visible but disabled.`,
            );
          }
          completed.add("visible-target");
        }

        for (const action of expectation.actions ?? []) {
          let actionTarget: HTMLElement | undefined;
          if (action.kind === "activate") {
            if (expectation.contribution.service !== "ui.sidebar.views") {
              return failure(
                input,
                foundRefs,
                completed,
                "interaction",
                `Automatic verification activation is not safe for ` +
                  `${expectation.contribution.service}; verify visibility and ` +
                  `leave the user-facing action untouched.`,
              );
            }
            if (!target) {
              return failure(
                input,
                foundRefs,
                completed,
                "interaction",
                "Activation requires a visibleTarget expectation.",
              );
            }
            actionTarget = target;
          } else {
            const currentRoots = ownedRoots(documentRef, {
              pluginId: input.pluginId,
              generation: input.generation,
              service: expectation.contribution.service,
              key: expectation.contribution.key,
            });
            actionTarget = semanticTargets(currentRoots, action.target).find((element) =>
              isVisible(element, documentRef)
            );
            if (!actionTarget) {
              return failure(
                input,
                foundRefs,
                completed,
                "interaction",
                `The owned contribution has no visible ${action.target.role} ` +
                  `named "${action.target.name}" to click.`,
              );
            }
          }
          const disabled = actionTarget.matches(":disabled") ||
            actionTarget.getAttribute("aria-disabled") === "true";
          if (disabled) {
            return failure(
              input,
              foundRefs,
              completed,
              "interaction",
              "The owned interaction target is disabled.",
            );
          }
          actionTarget.click();
          await settleInteraction();
          completed.add("interaction");
        }

        for (const postcondition of expectation.after ?? []) {
          const satisfied = () => {
            const currentRoots = ownedRoots(documentRef, {
              pluginId: input.pluginId,
              generation: input.generation,
              service: expectation.contribution.service,
              key: expectation.contribution.key,
            });
            return "selectedContribution" in postcondition
              ? postcondition.selectedContribution === expectation.contribution.key &&
                currentRoots.some(
                  (root) => root.dataset.contributionSelected === "true",
                )
              : semanticTargets(currentRoots, postcondition).some((element) =>
                  isVisible(element, documentRef)
                );
          };
          if (!(await observePostcondition(documentRef, satisfied))) {
            const detail = "selectedContribution" in postcondition
              ? `selected contribution "${postcondition.selectedContribution}"`
              : `${postcondition.role} named "${postcondition.name}"`;
            return failure(
              input,
              foundRefs,
              completed,
              "postcondition",
              `The declared ${detail} postcondition was not observed on the owned contribution.`,
            );
          }
        }
        if ((expectation.after?.length ?? 0) > 0) completed.add("postcondition");
      }

      return {
        ok: true,
        pluginId: input.pluginId,
        generation: input.generation,
        refs: foundRefs,
        completedStages: [...completed],
        message: "Every declared contribution expectation was verified.",
      };
    },
  };
}
