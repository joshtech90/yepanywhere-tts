import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../../i18n";
import { SessionPathLinkOptions } from "../../components/SessionPathLinkOptions";
import { TextBlock } from "../../components/blocks/TextBlock";
import { ProjectPathLinkSettingsProvider } from "../ProjectPathLinkSettingsContext";
import { SessionMetadataProvider } from "../SessionMetadataContext";
import { UI_KEYS } from "../../lib/storageKeys";

function Session({ id }: { id: string }) {
  return (
    <ProjectPathLinkSettingsProvider>
      <SessionMetadataProvider
        projectId="project"
        projectPath="/project"
        sessionId={id}
      >
        <section data-testid={id}>
          <SessionPathLinkOptions />
          <TextBlock
            text="In src/, open README.md."
            augmentHtml={
              '<p>In src/, open <span data-ya-directory-file="src/README.md"><a href="/root" data-ya-resource="project-file" data-ya-path="README.md">README.md</a></span>.</p>'
            }
          />
        </section>
      </SessionMetadataProvider>
    </ProjectPathLinkSettingsProvider>
  );
}

describe("session file-link settings", () => {
  it("overrides one session without changing defaults or another session", () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Session id="first" />
          <Session id="second" />
        </MemoryRouter>
      </I18nProvider>,
    );
    const first = within(screen.getByTestId("first"));
    const second = within(screen.getByTestId("second"));
    expect(first.getByRole("link", { name: "src/README.md" })).toBeTruthy();
    fireEvent.change(
      first.getByRole("combobox", { name: "Use Mentioned Directories" }),
      { target: { value: "false" } },
    );
    expect(
      first.getByRole("link", { name: "README.md" }).getAttribute("href"),
    ).toBe("/root");
    expect(second.getByRole("link", { name: "src/README.md" })).toBeTruthy();
    fireEvent.change(
      first.getByRole("combobox", { name: "Link Project Paths" }),
      { target: { value: "false" } },
    );
    expect(first.queryByRole("link")).toBeNull();
    expect(
      first.getByRole<HTMLSelectElement>("combobox", {
        name: "Use Mentioned Directories",
      }).disabled,
    ).toBe(true);
    expect(localStorage.getItem(UI_KEYS.projectPathLinks)).toBeNull();
    expect(localStorage.getItem(UI_KEYS.mentionedDirectoryLinks)).toBeNull();
    fireEvent.change(
      first.getByRole("combobox", { name: "Link Project Paths" }),
      { target: { value: "default" } },
    );
    fireEvent.change(
      first.getByRole("combobox", { name: "Use Mentioned Directories" }),
      { target: { value: "default" } },
    );
    expect(first.getByRole("link", { name: "src/README.md" })).toBeTruthy();
  });
});
