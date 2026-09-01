import { describe, expect, it } from "vitest";
import type { UiShellContributionStore } from "./registry";
import { createContributionEvidence } from "./evidence";

function store(): UiShellContributionStore {
  return {
    entries: (service) => service === "ui.sidebar.views"
      ? [{
          pluginId: "calculator-plugin",
          generation: "sha256-calculator-v1",
          key: "calculator",
          value: { id: "calculator" },
        }] as never
      : [],
    snapshot: () => 1,
    subscribe: () => () => {},
    dispose: () => {},
  };
}

describe("owned contribution evidence", () => {
  it("rejects an identically named control owned by another plugin", async () => {
    document.body.innerHTML = `
      <button
        aria-label="Calculator"
        data-plugin-owner="other-plugin"
        data-plugin-generation="sha256-other"
        data-contribution-service="ui.sidebar.views"
        data-contribution-key="other"
      >Calculator</button>
    `;

    const evidence = createContributionEvidence(store(), document);
    await expect(evidence.verify({
      pluginId: "calculator-plugin",
      generation: "sha256-calculator-v1",
      expectations: [{
        contribution: { service: "ui.sidebar.views", key: "calculator" },
        present: true,
        visibleTarget: { role: "button", name: "Calculator" },
      }],
    })).resolves.toMatchObject({
      ok: false,
      failedStage: "surface-mounted",
    });
  });

  it("proves ownership, activation, and the declared selected postcondition", async () => {
    document.body.innerHTML = `
      <button
        aria-label="Calculator"
        data-plugin-owner="calculator-plugin"
        data-plugin-generation="sha256-calculator-v1"
        data-contribution-service="ui.sidebar.views"
        data-contribution-key="calculator"
        data-contribution-selected="false"
      >Calculator</button>
      <section
        data-plugin-owner="calculator-plugin"
        data-plugin-generation="sha256-calculator-v1"
        data-contribution-service="ui.sidebar.views"
        data-contribution-key="calculator"
        data-contribution-selected="false"
      ><h2>Calculator</h2></section>
    `;
    const button = document.querySelector("button")!;
    button.addEventListener("click", () => {
      for (const element of document.querySelectorAll<HTMLElement>(
        '[data-contribution-key="calculator"]',
      )) element.dataset.contributionSelected = "true";
    });

    const evidence = createContributionEvidence(store(), document);
    await expect(evidence.verify({
      pluginId: "calculator-plugin",
      generation: "sha256-calculator-v1",
      expectations: [{
        contribution: { service: "ui.sidebar.views", key: "calculator" },
        present: true,
        visibleTarget: { role: "button", name: "Calculator" },
        actions: [{ kind: "activate" }],
        after: [
          { selectedContribution: "calculator" },
          { role: "heading", name: "Calculator", visible: true },
        ],
      }],
    })).resolves.toMatchObject({
      ok: true,
      completedStages: [
        "contribution-registered",
        "surface-mounted",
        "visible-target",
        "interaction",
        "postcondition",
      ],
    });
  });

  it("activates a sidebar view, clicks an owned control, and observes its resulting state", async () => {
    document.body.innerHTML = `
      <button
        aria-label="Counter QA"
        data-plugin-owner="calculator-plugin"
        data-plugin-generation="sha256-calculator-v1"
        data-contribution-service="ui.sidebar.views"
        data-contribution-key="calculator"
        data-contribution-selected="false"
      >Counter QA</button>
      <section
        data-plugin-owner="calculator-plugin"
        data-plugin-generation="sha256-calculator-v1"
        data-contribution-service="ui.sidebar.views"
        data-contribution-key="calculator"
        data-contribution-selected="false"
        hidden
      >
        <h2>Counter QA</h2>
        <output role="status">Counter: 0</output>
        <button>Increment QA counter</button>
      </section>
    `;
    const railButton = document.querySelector<HTMLButtonElement>("body > button")!;
    const view = document.querySelector<HTMLElement>("section")!;
    railButton.addEventListener("click", () => {
      railButton.dataset.contributionSelected = "true";
      view.dataset.contributionSelected = "true";
      view.hidden = false;
    });
    view.querySelector("button")!.addEventListener("click", () => {
      setTimeout(() => {
        view.querySelector("output")!.textContent = "Counter: 1";
      }, 10);
    });

    const evidence = createContributionEvidence(store(), document);
    await expect(evidence.verify({
      pluginId: "calculator-plugin",
      generation: "sha256-calculator-v1",
      expectations: [{
        contribution: { service: "ui.sidebar.views", key: "calculator" },
        present: true,
        visibleTarget: { role: "button", name: "Counter QA" },
        actions: [
          { kind: "activate" },
          {
            kind: "click",
            target: { role: "button", name: "Increment QA counter" },
          },
        ],
        after: [
          { selectedContribution: "calculator" },
          { role: "status", name: "Counter: 1", visible: true },
        ],
      }],
    } as never)).resolves.toMatchObject({
      ok: true,
      completedStages: [
        "contribution-registered",
        "surface-mounted",
        "visible-target",
        "interaction",
        "postcondition",
      ],
    });
  });
});
