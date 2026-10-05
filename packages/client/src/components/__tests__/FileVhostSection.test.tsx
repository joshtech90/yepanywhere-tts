// @vitest-environment jsdom

import type { ArtifactVhostSiteView } from "@yep-anywhere/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import {
  FileVhostSection,
  type FileVhostService,
  suggestVhostName,
} from "../FileVhostSection";

afterEach(cleanup);

function service(overrides: Partial<FileVhostService> = {}): FileVhostService {
  return {
    hostSuffix: "example.org",
    list: vi.fn().mockResolvedValue([]),
    serve: vi.fn(
      async ({ name, path, public: open }): Promise<ArtifactVhostSiteView> => ({
        name,
        path,
        public: open,
        kind: "file",
        publicUrl: `https://${name}.example.org/`,
      }),
    ),
    stop: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

it("suggests a DNS label from the file name", () => {
  expect(suggestVhostName("build/Promotion Standalone.html")).toBe(
    "promotion-standalone",
  );
  expect(suggestVhostName("dist/index.html")).toBe("");
});

it("claims a public address and reports a taken name", async () => {
  const taken = service({
    serve: vi.fn().mockRejectedValue(new Error('The name "page" is taken')),
  });
  const { rerender } = render(
    <I18nProvider>
      <FileVhostSection filePath="docs/page.html" service={taken} />
    </I18nProvider>,
  );
  const name = await screen.findByRole("textbox", { name: "Address name" });
  expect(name).toHaveProperty("value", "page");
  fireEvent.click(screen.getByRole("button", { name: "Serve here" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    'The name "page" is taken',
  );

  const free = service();
  rerender(
    <I18nProvider>
      <FileVhostSection filePath="docs/page.html" service={free} />
    </I18nProvider>,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Address name" }), {
    target: { value: "Garden" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Serve here" }));
  await waitFor(() =>
    expect(free.serve).toHaveBeenCalledWith({
      name: "garden",
      path: "docs/page.html",
      public: true,
    }),
  );
  expect(
    await screen.findByRole("link", { name: "garden.example.org" }),
  ).toHaveProperty("href", "https://garden.example.org/");
});

it("requires a password before serving a password-protected address", async () => {
  const protectedService = service();
  render(
    <I18nProvider>
      <FileVhostSection filePath="page.html" service={protectedService} />
    </I18nProvider>,
  );
  fireEvent.change(await screen.findByRole("combobox", { name: "Access" }), {
    target: { value: "password" },
  });
  const serve = screen.getByRole("button", { name: "Serve here" });
  expect(serve).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "open sesame" },
  });
  fireEvent.click(serve);
  await waitFor(() =>
    expect(protectedService.serve).toHaveBeenCalledWith({
      name: "page",
      path: "page.html",
      public: true,
      password: "open sesame",
    }),
  );
});

it("keeps the suggested name for explicit replacement and accepts a manual name", async () => {
  const replacement = service({ canReplace: true });
  render(
    <I18nProvider>
      <FileVhostSection
        filePath="new-version/report.html"
        service={replacement}
      />
    </I18nProvider>,
  );
  const name = await screen.findByRole("textbox", { name: "Address name" });
  const checkbox = screen.getByRole("checkbox", {
    name: "Replace an existing mapping with this name",
  });
  expect(checkbox).toHaveProperty("checked", false);
  fireEvent.click(checkbox);
  expect(name).toHaveProperty("value", "report");
  fireEvent.click(screen.getByRole("button", { name: "Serve here" }));
  await waitFor(() =>
    expect(replacement.serve).toHaveBeenCalledWith({
      name: "report",
      path: "new-version/report.html",
      public: true,
      replace: true,
    }),
  );
  fireEvent.change(name, { target: { value: "Manual" } });
  fireEvent.click(screen.getByRole("button", { name: "Serve here" }));
  await waitFor(() =>
    expect(replacement.serve).toHaveBeenLastCalledWith({
      name: "manual",
      path: "new-version/report.html",
      public: true,
      replace: true,
    }),
  );
});
