import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectQueueReadinessSettings } from "../ProjectQueueReadinessSettings";

vi.mock("../../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("ProjectQueueReadinessSettings", () => {
  it("saves the executable and literal argument lines only on explicit save", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<ProjectQueueReadinessSettings command={null} onSave={save} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("projectQueueReadinessExecutable"), {
      target: { value: "/usr/bin/agentctl" },
    });
    fireEvent.change(screen.getByLabelText("projectQueueReadinessArguments"), {
      target: { value: "others\n--text\nargument with spaces" },
    });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "projectQueueReadinessSave" }),
    );
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        executable: "/usr/bin/agentctl",
        args: ["others", "--text", "argument with spaces"],
      }),
    );
  });

  it("disables the server check with explicit null", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <ProjectQueueReadinessSettings
        command={{ executable: "agentctl", args: ["others", "--text"] }}
        onSave={save}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "projectQueueReadinessSave" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledWith(null));
  });

  it("keeps invalid executable drafts out of server settings", () => {
    const save = vi.fn();
    render(<ProjectQueueReadinessSettings command={null} onSave={save} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "projectQueueReadinessSave" }),
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "projectQueueReadinessSettingInvalid",
    );
    expect(save).not.toHaveBeenCalled();
  });
});
