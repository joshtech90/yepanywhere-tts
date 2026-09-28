// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterDropdown } from "../FilterDropdown";
import styles from "../FilterDropdown.module.css";

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

const DESKTOP_WIDTH = 1024;
const PHONE_WIDTH = 375;

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

function setViewportHeight(height: number) {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
  });
}

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 300,
    width: 300,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

/**
 * Lays out the trigger at the given rows, an optional clipping ancestor, and
 * a panel whose unclamped content is `panelContentHeight` tall. jsdom has no
 * layout, so these stand in for what the browser would measure.
 */
function mockPanelLayout({
  trigger,
  panelContentHeight,
  clip,
}: {
  trigger: { top: number; bottom: number };
  panelContentHeight: number;
  clip?: { top: number; height: number };
}) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this.getAttribute("aria-haspopup") === "listbox") {
        return rect(trigger.top, trigger.bottom);
      }
      if (clip && this.getAttribute("data-clip") === "true") {
        return rect(clip.top, clip.top + clip.height);
      }
      return rect(0, 0);
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return clip && this.getAttribute("data-clip") === "true"
        ? clip.height
        : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.getAttribute("role") === "dialog" ? panelContentHeight : 0;
    },
  );
}

function openTrigger() {
  fireEvent.click(screen.getByRole("button", { name: "filterByLabel" }));
}

describe("FilterDropdown", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    setViewportHeight(768);
    setViewportWidth(DESKTOP_WIDTH);
    document.body.style.overflow = "";
  });

  it("renders a named boundary before additional model options", () => {
    render(
      <FilterDropdown
        label="Models"
        options={[
          { value: "latest", label: "Latest" },
          {
            value: "previous",
            label: "Previous",
            groupLabelBefore: "Previous models",
          },
        ]}
        selected={["latest"]}
        onChange={vi.fn()}
        multiSelect={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "filterByLabel" }));

    expect(screen.getByText("Previous models")).toBeTruthy();
    expect(screen.getByText("Previous")).toBeTruthy();
  });

  it("renders trailing option metadata", () => {
    render(
      <FilterDropdown
        label="Models"
        options={[
          {
            value: "fable",
            label: "Fable",
            meta: <span>100% used</span>,
          },
        ]}
        selected={[]}
        onChange={vi.fn()}
        multiSelect={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "filterByLabel" }));

    expect(screen.getByText("100% used")).toBeTruthy();
  });

  it("toggles open and closed from the trigger", () => {
    render(
      <FilterDropdown
        label="Status"
        options={[{ value: "unread", label: "Unread" }]}
        selected={[]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    openTrigger();
    expect(screen.getByRole("dialog")).toBeTruthy();
    openTrigger();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape", () => {
    render(
      <FilterDropdown
        label="Status"
        options={[{ value: "unread", label: "Unread" }]}
        selected={[]}
        onChange={vi.fn()}
      />,
    );

    openTrigger();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on a click outside the desktop dropdown", () => {
    render(
      <FilterDropdown
        label="Status"
        options={[{ value: "unread", label: "Unread" }]}
        selected={[]}
        onChange={vi.fn()}
      />,
    );

    openTrigger();
    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("selects a single value and closes", () => {
    const onChange = vi.fn();
    render(
      <FilterDropdown
        label="Models"
        options={[
          { value: "fable", label: "Fable" },
          { value: "opus", label: "Opus" },
        ]}
        selected={[]}
        onChange={onChange}
        multiSelect={false}
      />,
    );

    openTrigger();
    fireEvent.click(screen.getByRole("button", { name: "Opus" }));

    expect(onChange).toHaveBeenCalledWith(["opus"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("accumulates multi-select values and stays open", () => {
    const onChange = vi.fn();
    render(
      <FilterDropdown
        label="Status"
        options={[
          { value: "unread", label: "Unread" },
          { value: "starred", label: "Starred" },
        ]}
        selected={["unread"]}
        onChange={onChange}
      />,
    );

    openTrigger();
    fireEvent.click(screen.getByRole("button", { name: "Starred" }));

    expect(onChange).toHaveBeenCalledWith(["unread", "starred"]);
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "filterClearAll" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("aligns the desktop dropdown to the right on request", () => {
    render(
      <FilterDropdown
        label="Interface"
        options={[{ value: "lan", label: "LAN" }]}
        selected={[]}
        onChange={vi.fn()}
        align="right"
      />,
    );

    openTrigger();

    expect(screen.getByRole("dialog").className).toContain(styles.alignRight);
  });

  it("renders the narrow-viewport sheet through a portal", () => {
    setViewportWidth(PHONE_WIDTH);
    const { container } = render(
      <FilterDropdown
        label="Status"
        options={[{ value: "unread", label: "Unread" }]}
        selected={[]}
        onChange={vi.fn()}
      />,
    );

    openTrigger();

    const sheet = screen.getByRole("dialog");
    // The sheet mounts on document.body, not inside the component's container.
    expect(container.contains(sheet)).toBe(false);
    expect(document.body.contains(sheet)).toBe(true);
    expect(sheet.className).toContain(styles.sheet);
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("caps the desktop panel to the room below the trigger", () => {
    setViewportHeight(700);
    mockPanelLayout({
      trigger: { top: 100, bottom: 130 },
      panelContentHeight: 900,
    });
    render(
      <FilterDropdown
        label="Models"
        options={[{ value: "fable", label: "Fable" }]}
        selected={[]}
        onChange={vi.fn()}
      />,
    );

    openTrigger();
    const panel = screen.getByRole("dialog");

    expect(panel.className).not.toContain(styles.above);
    expect(
      panel.style.getPropertyValue("--filter-dropdown-available-height"),
    ).toBe("562px");
  });

  it("opens upward when a low trigger has more room above", () => {
    setViewportHeight(700);
    mockPanelLayout({
      trigger: { top: 560, bottom: 590 },
      panelContentHeight: 400,
    });
    render(
      <FilterDropdown
        label="Models"
        options={[{ value: "fable", label: "Fable" }]}
        selected={[]}
        onChange={vi.fn()}
      />,
    );

    openTrigger();
    const panel = screen.getByRole("dialog");

    expect(panel.className).toContain(styles.above);
    expect(
      panel.style.getPropertyValue("--filter-dropdown-available-height"),
    ).toBe("552px");
  });

  it("stays below a low trigger when its content fits there", () => {
    setViewportHeight(700);
    mockPanelLayout({
      trigger: { top: 560, bottom: 590 },
      panelContentHeight: 80,
    });
    render(
      <FilterDropdown
        label="Models"
        options={[{ value: "fable", label: "Fable" }]}
        selected={[]}
        onChange={vi.fn()}
      />,
    );

    openTrigger();

    expect(screen.getByRole("dialog").className).not.toContain(styles.above);
  });

  it("measures room against a scrolling ancestor, not only the window", () => {
    setViewportHeight(900);
    mockPanelLayout({
      trigger: { top: 150, bottom: 180 },
      panelContentHeight: 1000,
      clip: { top: 100, height: 400 },
    });
    render(
      <div data-clip="true" style={{ overflowY: "auto" }}>
        <FilterDropdown
          label="Models"
          options={[{ value: "fable", label: "Fable" }]}
          selected={[]}
          onChange={vi.fn()}
        />
      </div>,
    );

    openTrigger();
    const panel = screen.getByRole("dialog");

    expect(panel.className).not.toContain(styles.above);
    expect(
      panel.style.getPropertyValue("--filter-dropdown-available-height"),
    ).toBe("312px");
  });

  it("applies the full-width variant to the container and trigger", () => {
    const { container } = render(
      <FilterDropdown
        label="Model"
        options={[{ value: "fable", label: "Fable" }]}
        selected={[]}
        onChange={vi.fn()}
        fullWidth
      />,
    );

    const root = container.firstElementChild;
    const trigger = screen.getByRole("button", { name: "filterByLabel" });

    expect(root?.className).toContain(styles.fullWidth);
    expect(trigger.className).toContain(styles.fullWidth);
  });

  it("applies caller trigger classes without exposing internals", () => {
    render(
      <FilterDropdown
        label="Status"
        options={[{ value: "unread", label: "Unread" }]}
        selected={[]}
        onChange={vi.fn()}
        triggerClassName="filter-dropdown-trigger--status"
      />,
    );

    expect(
      screen.getByRole("button", { name: "filterByLabel" }).className,
    ).toContain("filter-dropdown-trigger--status");
  });
});
