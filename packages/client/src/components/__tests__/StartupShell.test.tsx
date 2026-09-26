import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { StartupShell, isSessionStartupPath } from "../StartupShell";

describe("StartupShell", () => {
  it("recognizes direct and relay selected-session routes", () => {
    expect(isSessionStartupPath("/projects/project-1/sessions/session-1")).toBe(
      true,
    );
    expect(
      isSessionStartupPath(
        "/-/relay/host/projects/project-1/sessions/session-1",
      ),
    ).toBe(true);
    expect(isSessionStartupPath("/projects/project-1")).toBe(false);
    expect(isSessionStartupPath("/share/secret")).toBe(false);
  });

  it("keeps session-shaped geometry around module status", () => {
    const { container } = render(
      <MemoryRouter
        initialEntries={["/-/relay/host/projects/project-1/sessions/session-1"]}
      >
        <StartupShell phase="module">Loading…</StartupShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole("status").textContent).toContain("Loading…");
    expect(
      container.firstElementChild?.getAttribute("data-startup-shell"),
    ).toBe("session");
    expect(
      container.firstElementChild?.getAttribute("data-startup-phase"),
    ).toBe("module");
  });

  it("uses the simpler page shell away from a selected session", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/login"]}>
        <StartupShell phase="connection">Reconnecting...</StartupShell>
      </MemoryRouter>,
    );

    expect(
      container.firstElementChild?.getAttribute("data-startup-shell"),
    ).toBe("page");
  });

  describe("on Cockpit routes", () => {
    afterEach(() => localStorage.clear());

    it("loads on the Cockpit's own background without the classic skeleton", () => {
      localStorage.setItem(
        "yep-anywhere-cockpit-appearance",
        JSON.stringify({ version: 1, theme: "dark", accent: "blue" }),
      );
      const { container } = render(
        <MemoryRouter
          initialEntries={["/cockpit/projects/project-1/sessions/session-1"]}
        >
          <StartupShell phase="module">Loading…</StartupShell>
        </MemoryRouter>,
      );

      const shell = container.firstElementChild;
      expect(shell?.getAttribute("data-startup-shell")).toBe("cockpit");
      expect(shell?.getAttribute("data-theme")).toBe("dark");
      expect(screen.getByRole("status").textContent).toContain("Loading…");
    });

    it("also covers relay Cockpit routes", () => {
      const { container } = render(
        <MemoryRouter initialEntries={["/-/relay/host/cockpit"]}>
          <StartupShell phase="connection">Reconnecting...</StartupShell>
        </MemoryRouter>,
      );

      expect(
        container.firstElementChild?.getAttribute("data-startup-shell"),
      ).toBe("cockpit");
    });
  });
});
