import { describe, expect, it } from "vitest";
import { createLocalStorageValue } from "../localStorageValue";

const key = "fixture-isolation-probe";
const preference = createLocalStorageValue<string>(
  key,
  "default",
  (raw) => raw,
);

describe.sequential("browser storage fixture ownership", () => {
  it("lets a case mutate persistent and cached preferences", () => {
    preference.set("previous-case");
    sessionStorage.setItem(key, "previous-case");
    expect(preference.read()).toBe("previous-case");
  });
  it("starts the next case with fresh storage and a fresh preference snapshot", () => {
    expect(localStorage.getItem(key)).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(preference.read()).toBe("default");
  });
});
