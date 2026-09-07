import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n";
import {
  QueuedEffortBadge,
  type QueuedEffortContext,
} from "../QueuedEffortBadge";

const context: QueuedEffortContext = {
  provider: "codex",
  normal: "on:high",
  model: {
    id: "model",
    name: "Model",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "ultra"].map(
      (reasoningEffort) => ({ reasoningEffort }),
    ),
  },
};

describe("queued effort badge", () => {
  it("shows the resolved UI effort and follows the present setting", () => {
    const { container, rerender } = render(
      <I18nProvider>
        <QueuedEffortBadge modifier="slowest" context={context} />
      </I18nProvider>,
    );
    expect(container.textContent).toBe("Max");
    rerender(
      <I18nProvider>
        <QueuedEffortBadge
          modifier="slowest"
          context={{ ...context, normal: "on:max" }}
        />
      </I18nProvider>,
    );
    expect(container.textContent).toBe("");
    rerender(
      <I18nProvider>
        <QueuedEffortBadge modifier="fastest" context={context} />
      </I18nProvider>,
    );
    expect(container.textContent).toBe("Off");
  });
  it("omits badges for ordinary items and unknown defaults", () => {
    const { container, rerender } = render(
      <I18nProvider>
        <QueuedEffortBadge context={context} />
      </I18nProvider>,
    );
    expect(container.textContent).toBe("");
    rerender(
      <I18nProvider>
        <QueuedEffortBadge
          modifier="fast"
          context={{
            ...context,
            normal: "auto",
            model: { ...context.model, defaultReasoningEffort: undefined },
          }}
        />
      </I18nProvider>,
    );
    expect(container.textContent).toBe("");
  });
});
