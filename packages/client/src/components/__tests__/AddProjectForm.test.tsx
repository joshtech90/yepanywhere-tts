// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { Project } from "../../types";
import { AddProjectForm, type AddProjectRequest } from "../AddProjectForm";

afterEach(cleanup);

const existing = {
  id: "p1",
  path: "/home/u/dragon-story",
  name: "Dragon Story",
  sessionCount: 0,
} as Project;

function renderForm(pathBase = "~") {
  const onSubmit = vi.fn<(request: AddProjectRequest) => void>();
  render(
    <I18nProvider>
      <AddProjectForm
        projects={[existing]}
        pathBase={pathBase}
        chooseName
        chooseCodeName={false}
        adding={false}
        error={null}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />
    </I18nProvider>,
  );
  const pathInput = screen.getByRole("textbox", {
    name: "Project path",
  }) as HTMLInputElement;
  const nameInput = screen.getByRole("textbox", {
    name: "Name",
  }) as HTMLInputElement;
  return { onSubmit, pathInput, nameInput };
}

/** Type one character at a time, as a person does. */
function typeInto(input: HTMLInputElement, text: string) {
  for (const char of text) {
    fireEvent.change(input, { target: { value: input.value + char } });
  }
}

describe("AddProjectForm paths from names", () => {
  it("derives the path from a name typed first, before blur", () => {
    const { pathInput, nameInput } = renderForm("/srv/kid");
    typeInto(nameInput, "My Cat");
    expect(pathInput.value).toBe("/srv/kid/my-cat");
    expect(nameInput.value).toBe("My Cat");
  });

  it("puts a bare path-box word under home on blur and submits it", () => {
    const { onSubmit, pathInput, nameInput } = renderForm();
    typeInto(pathInput, "story1");
    expect(nameInput.value).toBe("story1");
    fireEvent.blur(pathInput);
    expect(pathInput.value).toBe("~/story1");
    fireEvent.submit(pathInput.closest("form") as HTMLFormElement);
    expect(onSubmit).toHaveBeenCalledWith({ path: "~/story1" });
  });

  it("submits a settled path even without a blur", () => {
    const { onSubmit, pathInput } = renderForm();
    typeInto(pathInput, "story1");
    fireEvent.submit(pathInput.closest("form") as HTMLFormElement);
    expect(onSubmit).toHaveBeenCalledWith({ path: "~/story1" });
  });

  it("moves a path-box description to the name", () => {
    const { onSubmit, pathInput, nameInput } = renderForm();
    typeInto(pathInput, "My Cat Game");
    fireEvent.blur(pathInput);
    expect(nameInput.value).toBe("My Cat Game");
    expect(pathInput.value).toBe("~/my-cat-game");
    fireEvent.submit(pathInput.closest("form") as HTMLFormElement);
    expect(onSubmit).toHaveBeenCalledWith({
      path: "~/my-cat-game",
      name: "My Cat Game",
    });
  });

  it("reopens an existing project by name without renaming it", () => {
    const { onSubmit, pathInput, nameInput } = renderForm();
    typeInto(nameInput, "dragon story");
    expect(pathInput.value).toBe("/home/u/dragon-story");
    fireEvent.submit(pathInput.closest("form") as HTMLFormElement);
    expect(onSubmit).toHaveBeenCalledWith({ path: "/home/u/dragon-story" });
  });

  it("keeps a typed path when the name changes afterwards", () => {
    const { pathInput, nameInput } = renderForm();
    typeInto(pathInput, "/tmp/x");
    typeInto(nameInput, "Other");
    expect(pathInput.value).toBe("/tmp/x");
  });
});
