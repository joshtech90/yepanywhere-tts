import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SqliteDatabase } from "@yep-anywhere/shared/sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, createTestDatabase } from "../src/db.js";
import { PushRepository, SubscriptionLimitError } from "../src/repository.js";
import type { PushTarget } from "../src/types.js";

const TARGET: PushTarget = {
  provider: "fcm",
  kind: "fid",
  value: "installation-target",
};

describe("PushRepository", () => {
  let db: SqliteDatabase | undefined;
  let temporaryDirectory: string | undefined;

  afterEach(() => {
    // The shared adapter's close is idempotent, so no open check is needed.
    db?.close();
    db = undefined;
    if (temporaryDirectory) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = undefined;
    }
  });

  it("stores verifiers rather than plaintext capabilities", () => {
    db = createTestDatabase();
    const repository = new PushRepository(db);

    const installation = repository.createInstallation(TARGET);
    const subscription = repository.createSubscription(
      installation.installationId,
    );
    const row = db
      .prepare(
        `SELECT installations.auth_hash, subscriptions.send_hash
         FROM installations
         JOIN subscriptions
           ON subscriptions.installation_id = installations.id`,
      )
      .get<{ auth_hash: Uint8Array; send_hash: Uint8Array }>();
    if (!row) throw new Error("expected one joined installation row");

    // Built-in SQLite returns BLOB columns as Uint8Array, not Node Buffer.
    const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
    expect(row.auth_hash).toBeInstanceOf(Uint8Array);
    expect(row.send_hash).toBeInstanceOf(Uint8Array);
    expect(row.auth_hash).toHaveLength(32);
    expect(row.send_hash).toHaveLength(32);
    expect(decode(row.auth_hash)).not.toContain(
      installation.installationSecret,
    );
    expect(decode(row.send_hash)).not.toContain(subscription.sendSecret);
  });

  it("authenticates installations and atomically replaces their target", () => {
    let now = 10;
    db = createTestDatabase();
    const repository = new PushRepository(db, { now: () => now });
    const credentials = repository.createInstallation(TARGET);

    expect(
      repository.authenticateInstallation(
        credentials.installationId,
        "x".repeat(43),
      ),
    ).toBeUndefined();
    expect(
      repository.authenticateInstallation(
        credentials.installationId,
        credentials.installationSecret,
      )?.target,
    ).toEqual(TARGET);

    now = 20;
    const replacement: PushTarget = {
      provider: "fcm",
      kind: "registration_token",
      value: "replacement-target",
    };
    expect(
      repository.updateInstallationTarget(
        credentials.installationId,
        replacement,
      ),
    ).toBe(true);
    expect(
      repository.authenticateInstallation(
        credentials.installationId,
        credentials.installationSecret,
      ),
    ).toMatchObject({ target: replacement, updatedAt: 20 });
  });

  it("resolves a subscription only to its stored installation target", () => {
    db = createTestDatabase();
    const repository = new PushRepository(db);
    const installation = repository.createInstallation(TARGET);
    const subscription = repository.createSubscription(
      installation.installationId,
    );

    expect(
      repository.authenticateSubscription(
        subscription.subscriptionId,
        subscription.sendSecret,
      ),
    ).toMatchObject({
      id: subscription.subscriptionId,
      installationId: installation.installationId,
      target: TARGET,
    });
    expect(
      repository.authenticateSubscription(
        subscription.subscriptionId,
        "x".repeat(43),
      ),
    ).toBeUndefined();
  });

  it("enforces the active-subscription cap but permits replacement", () => {
    db = createTestDatabase();
    const repository = new PushRepository(db, {
      maxSubscriptionsPerInstallation: 1,
    });
    const installation = repository.createInstallation(TARGET);
    const first = repository.createSubscription(installation.installationId);

    expect(() =>
      repository.createSubscription(installation.installationId),
    ).toThrow(SubscriptionLimitError);

    expect(
      repository.revokeSubscription(
        installation.installationId,
        first.subscriptionId,
      ),
    ).toBe(true);
    expect(() =>
      repository.createSubscription(installation.installationId),
    ).not.toThrow();
  });

  it("persists subscriptions and revocation across reopen", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ya-push-repository-"));
    const databasePath = join(temporaryDirectory, "broker.db");
    db = createTestDatabase(databasePath);
    let repository = new PushRepository(db);
    const installation = repository.createInstallation(TARGET);
    const subscription = repository.createSubscription(
      installation.installationId,
    );
    db.close();

    db = createTestDatabase(databasePath);
    repository = new PushRepository(db);
    expect(
      repository.authenticateSubscription(
        subscription.subscriptionId,
        subscription.sendSecret,
      ),
    ).toBeDefined();
    expect(
      repository.revokeSubscription(
        installation.installationId,
        subscription.subscriptionId,
      ),
    ).toBe(true);
    db.close();

    db = createTestDatabase(databasePath);
    repository = new PushRepository(db);
    expect(
      repository.authenticateSubscription(
        subscription.subscriptionId,
        subscription.sendSecret,
      ),
    ).toBeUndefined();
  });

  it("creates the persistent database with owner-only permissions", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ya-push-database-"));
    db = createDatabase(temporaryDirectory);

    expect(
      statSync(join(temporaryDirectory, "push-broker.db")).mode & 0o777,
    ).toBe(0o600);
  });

  it("cascades subscriptions when an installation is deleted", () => {
    db = createTestDatabase();
    const repository = new PushRepository(db);
    const installation = repository.createInstallation(TARGET);
    repository.createSubscription(installation.installationId);

    expect(repository.deleteInstallation(installation.installationId)).toBe(
      true,
    );
    expect(repository.countInstallations()).toBe(0);
    expect(repository.countActiveSubscriptions()).toBe(0);
  });
});
