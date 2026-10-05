import { describe, expect, it } from "vitest";
import { describeGitFailure, redactGitError } from "./gitActionError";

const t = (key: string) => key;

describe("Git action errors", () => {
  it.each([
    [
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      "HttpsAuth",
    ],
    [
      "fatal: Authentication failed for 'https://github.com/org/repo.git/'",
      "HttpsAuth",
    ],
    ["git@github.com: Permission denied (publickey).", "SshAuth"],
    [
      "Bad owner or permissions on C:/Users/example/.ssh/config",
      "SshPermissions",
    ],
    ["fatal: Authentication failed", "Auth"],
    [
      "ssh: connect to host github.com port 22: Connection timed out",
      "Timeout",
    ],
    ["! [rejected] main -> main (non-fast-forward)", "NonFastForward"],
    ["fatal: Not possible to fast-forward, aborting.", "NonFastForward"],
  ])("explains %s", (detail, kind) => {
    expect(describeGitFailure(detail, t)).toEqual({
      reason: `gitStatusError${kind}`,
      hint: `gitStatusError${kind}Hint`,
      detail,
    });
  });

  it("includes the execution limit when the server identifies a timeout", () => {
    const translate = (key: string, vars?: Record<string, string | number>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key;
    expect(
      describeGitFailure(
        "Git operation timed out after 60 seconds.\nConnecting...",
        translate,
      ),
    ).toMatchObject({
      reason: 'gitStatusErrorTimeoutSeconds {"seconds":"60"}',
      hint: "gitStatusErrorTimeoutHint",
    });
  });

  it("keeps unknown errors and missing details without inventing a cause", () => {
    expect(
      describeGitFailure(
        "remote: hook declined https://github.com/org/repo",
        t,
      ),
    ).toMatchObject({ reason: null, hint: null });
    expect(describeGitFailure(undefined, t)).toEqual({
      reason: null,
      hint: null,
      detail: "",
    });
  });

  it("redacts credentials before displaying or copying diagnostics", () => {
    const detail =
      "fatal: Authentication failed for 'https://name:secret@github.com/org/repo?token=private&access_token=other&x=ok'\nAuthorization: Bearer sensitive\nAuthorization: Basic encoded";
    const safe = redactGitError(detail);
    expect(safe).toContain(
      "https://[redacted]@github.com/org/repo?token=[redacted]&access_token=[redacted]&x=ok",
    );
    for (const secret of [
      "secret",
      "private",
      "other",
      "sensitive",
      "encoded",
    ]) {
      expect(safe).not.toContain(secret);
    }
    expect(describeGitFailure(detail, t).detail).toBe(safe);
  });
});
