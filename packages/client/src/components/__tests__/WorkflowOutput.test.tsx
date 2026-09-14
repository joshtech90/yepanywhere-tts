import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { I18nProvider } from "../../i18n";
import { WorkflowOutput } from "../WorkflowOutput";

it("does not join incomplete JSON across command output boundaries", () => {
  const { container } = render(
    <I18nProvider>
      <WorkflowOutput
        text={'{"ok":\ntrue}\n'}
        workflow={{ markers: [], outputBoundaries: [0, 7] }}
      />
    </I18nProvider>,
  );
  expect(container.querySelector('[data-tool-output-kind="json"]')).toBeNull();
  expect(container.querySelector("pre")?.textContent).toBe('{"ok":\ntrue}\n');
});

it("keeps progress visible and reveals raw schema syntax only on expansion", () => {
  const declaration = "@@visualization-schema/1 /schema.json#ya-publish/1";
  const stage = "[publish][prepare]";
  const progress =
    "Checking completed commits, active work, and the publication checkout.";
  const text = `${declaration}\n${stage} ${progress}`;
  const { container } = render(
    <I18nProvider>
      <WorkflowOutput
        text={text}
        workflow={{
          markers: [
            {
              start: 0,
              end: declaration.length,
              prefix: declaration,
              title: "Publish YA",
              kind: "activation",
            },
            {
              start: declaration.length + 1,
              end: declaration.length + 1 + stage.length,
              prefix: stage,
              title: "Inspect work and commit completed changes",
              kind: "stage",
            },
          ],
        }}
      />
    </I18nProvider>,
  );
  expect(screen.getByText(progress, { exact: false })).toBeDefined();
  expect(screen.getByText("Workflow schema · Publish YA")).toBeDefined();
  expect(container.textContent).not.toContain(declaration);
  fireEvent.click(
    screen.getByRole("button", { name: "Expand original output" }),
  );
  expect(container.querySelector("[data-workflow-original]")?.textContent).toBe(
    text,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Collapse original output" }),
  );
  expect(screen.getByText(progress, { exact: false })).toBeDefined();
  expect(container.textContent).not.toContain(declaration);
});
