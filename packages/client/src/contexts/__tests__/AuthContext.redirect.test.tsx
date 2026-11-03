import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { AuthProvider } from "../AuthContext";
import { LoginPage } from "../../pages/LoginPage";

vi.mock("../../api/client", () => ({
  api: {
    getAuthStatus: async () => ({
      enabled: true,
      authenticated: false,
      setupRequired: false,
    }),
    login: async () => ({ success: true }),
  },
}));
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

afterEach(cleanup);

function CurrentLocation() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
      {location.hash}
    </output>
  );
}

it("opens the exact requested report after a fresh browser login", async () => {
  const target =
    "/projects/project-1/file?path=reports%2Fone.md&line=9#section";
  render(
    <MemoryRouter initialEntries={[target]}>
      <AuthProvider>
        <CurrentLocation />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/projects/:projectId/file" element={<p>Report</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  const password = await screen.findByLabelText("loginPasswordLabel");
  fireEvent.change(password, { target: { value: "fixture-password" } });
  fireEvent.click(screen.getByRole("button", { name: "loginSubmit" }));
  await waitFor(() =>
    expect(screen.getByTestId("location").textContent).toBe(target),
  );
  expect(screen.getByText("Report")).toBeTruthy();
});
