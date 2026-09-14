import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import {
  ProviderHostDegradedBanner,
  shouldShowProviderHostDegradedBanner,
} from "../ProviderHostDegradedBanner";

const version = vi.hoisted(() => ({
  value: { providerHostDegraded: true as boolean | undefined },
}));

vi.mock("../../hooks/useVersion", () => ({
  useVersion: () => ({ version: version.value, error: null }),
}));

describe("shouldShowProviderHostDegradedBanner", () => {
  it("shows only the explicit Linux degraded flag", () => {
    expect(shouldShowProviderHostDegradedBanner(null)).toBe(false);
    expect(shouldShowProviderHostDegradedBanner({})).toBe(false);
    expect(
      shouldShowProviderHostDegradedBanner({ providerHostDegraded: false }),
    ).toBe(false);
    expect(
      shouldShowProviderHostDegradedBanner({ providerHostDegraded: true }),
    ).toBe(true);
  });
});

describe("ProviderHostDegradedBanner", () => {
  it("renders a non-dismissible alert when the server reports degradation", () => {
    version.value = { providerHostDegraded: true };
    render(
      <I18nProvider>
        <ProviderHostDegradedBanner />
      </I18nProvider>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-provider-host-degraded")).toBe("true");
    expect(alert.textContent).toMatch(/Provider host is not running/);
    expect(alert.querySelector("button")).toBeNull();
  });
});
