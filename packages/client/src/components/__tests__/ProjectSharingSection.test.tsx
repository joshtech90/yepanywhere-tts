import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectSharingSection } from "../ProjectSharingSection";

const mock = vi.hoisted(() => ({
  principal: {
    superuser: false,
    username: "archer" as string | null,
    switched: false,
  },
  list: vi.fn(),
  set: vi.fn(),
}));
vi.mock("../../hooks/useVersion", () => ({
  useVersion: () => ({
    version: { capabilities: ["project-access-sharing"] },
  }),
}));
vi.mock("../../hooks/useActingPrincipal", () => ({
  useActingPrincipal: () => ({ principal: mock.principal, resolved: true }),
}));
vi.mock("../../api/projectAccess", () => ({
  projectAccessApi: { list: mock.list, set: mock.set },
}));
vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      vars ? `${key}:${Object.values(vars).join(",")}` : key,
  }),
}));

beforeEach(() => {
  mock.principal = { superuser: false, username: "archer", switched: false };
  mock.list.mockReset().mockResolvedValue({
    users: [
      { username: "bobby", level: "none", directoryLevel: "view" },
      { username: "carol", level: "join", directoryLevel: "none" },
    ],
  });
  mock.set.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

it("lets the creator share their project, saving each choice at once", async () => {
  render(<ProjectSharingSection projectId="p1" ownerUsername="archer" />);
  const bobby = await screen.findByRole("combobox", { name: "bobby" });
  expect(
    screen.getByText("projectSharingViaDirectory:usersAccessView"),
  ).toBeTruthy();
  fireEvent.change(bobby, { target: { value: "new-session" } });
  await waitFor(() =>
    expect(mock.set).toHaveBeenCalledWith("p1", "bobby", "new-session"),
  );
});

it("shows nothing to a limited user who did not create the project", () => {
  render(<ProjectSharingSection projectId="p1" ownerUsername="carol" />);
  expect(screen.queryByText("projectSharingTitle")).toBeNull();
  expect(mock.list).not.toHaveBeenCalled();
});

it("lets the superuser share any project", async () => {
  mock.principal = { superuser: true, username: null, switched: false };
  render(<ProjectSharingSection projectId="p1" />);
  expect(await screen.findByRole("combobox", { name: "carol" })).toBeTruthy();
});
