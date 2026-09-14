import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import {
  StorageFilesystemBanner,
  storageFilesystemDismissKey,
  storageNetworkFilesystem,
} from "../StorageFilesystemBanner";

const version = vi.hoisted(() => ({
  value: null as {
    sqlite?: { state: string; networkFilesystem?: string };
  } | null,
}));

vi.mock("../../hooks/useVersion", () => ({
  useVersion: () => ({ version: version.value, error: null }),
}));

function renderBanner() {
  return render(
    <I18nProvider>
      <StorageFilesystemBanner />
    </I18nProvider>,
  );
}

describe("storageNetworkFilesystem", () => {
  it("reads the name only when the server reported one", () => {
    expect(storageNetworkFilesystem(null)).toBe(null);
    expect(storageNetworkFilesystem({})).toBe(null);
    expect(storageNetworkFilesystem({ sqlite: { state: "ready" } })).toBe(null);
    expect(storageNetworkFilesystem({ sqlite: { state: "error" } })).toBe(null);
    expect(
      storageNetworkFilesystem({
        sqlite: { state: "error", networkFilesystem: "NFS" },
      }),
    ).toBe("NFS");
  });
});

describe("StorageFilesystemBanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
    version.value = null;
  });

  it("stays out of the way when storage is healthy", () => {
    version.value = { sqlite: { state: "ready" } };
    renderBanner();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names the filesystem and the environment variable that moves the data", () => {
    version.value = { sqlite: { state: "error", networkFilesystem: "NFS" } };
    renderBanner();
    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("NFS");
    expect(banner.textContent).toContain("YEP_DATA_DIR");
  });

  it("stays dismissed for that filesystem and returns for a different one", () => {
    version.value = { sqlite: { state: "error", networkFilesystem: "NFS" } };
    const first = renderBanner();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      window.localStorage.getItem(storageFilesystemDismissKey("NFS")),
    ).toBe("dismissed");
    first.unmount();

    renderBanner();
    expect(screen.queryByRole("alert")).toBeNull();

    version.value = { sqlite: { state: "error", networkFilesystem: "CIFS" } };
    renderBanner();
    expect(screen.getByRole("alert").textContent).toContain("CIFS");
  });
});
