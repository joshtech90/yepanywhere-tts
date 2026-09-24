import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../i18n";
import { CockpitPage } from "./CockpitPage";

afterEach(cleanup);

it("renders an independent Cockpit shell with links to the existing app", () => {
  const { container } = render(
    <MemoryRouter initialEntries={["/cockpit"]}>
      <I18nProvider>
        <CockpitPage />
      </I18nProvider>
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: "Cockpit" })).toBeTruthy();
  expect(
    screen.getAllByRole("link", { name: "All Sessions" })[0]?.getAttribute(
      "href",
    ),
  ).toBe("/sessions");
  expect(
    screen.getAllByRole("link", { name: "Projects" })[0]?.getAttribute(
      "href",
    ),
  ).toBe("/projects");
  expect(container.querySelector(".sidebar-desktop")).toBeNull();
});
