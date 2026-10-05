import {
  createHmac,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  DRAFT_MAX_BYTES,
  EMPTY_DRAFT,
  draftHasContent,
  draftPayloadEqual,
  draftSlotKey,
  type DraftPayload,
  type DraftRead,
  type DraftSlot,
  type DraftSnapshot,
  type DraftWrite,
  type DraftWriteResult,
} from "@yep-anywhere/shared";
import type { SqliteDatabase, SqliteStatement } from "../storage/sqlite.js";

const DAY = 86_400_000;
const RETENTION = 30 * DAY;
const GRACE = 7 * DAY;
const LIVE = Number.MAX_SAFE_INTEGER;
interface Row {
  slot_json: string;
  revision: string;
  sequence: number;
  payload: string;
  updated_at: number;
}

/** One prepared-statement owner per server generation. All CAS/receipts are atomic. */
export class DraftStore {
  private readonly statements = new Map<string, SqliteStatement>();
  private readonly secret: string;
  private readonly listeners = new Map<string, Set<() => void>>();
  constructor(
    private readonly db: SqliteDatabase,
    private readonly now = Date.now,
  ) {
    this.sql("INSERT OR IGNORE INTO draft_meta(id,secret) VALUES(1,?)").run(
      randomBytes(32).toString("hex"),
    );
    this.secret =
      this.sql("SELECT secret FROM draft_meta WHERE id=1").get<{
        secret: string;
      }>()?.secret ?? "";
  }
  private sql(query: string): SqliteStatement {
    let stmt = this.statements.get(query);
    if (!stmt) {
      stmt = this.db.prepare(query);
      this.statements.set(query, stmt);
    }
    return stmt;
  }
  private snapshot(owner: string, slot: DraftSlot): DraftSnapshot {
    const row = this.sql(
      "SELECT * FROM drafts WHERE owner=? AND slot=?",
    ).get<Row>(owner, draftSlotKey(slot));
    return row
      ? {
          slot,
          revision: row.revision,
          sequence: row.sequence,
          payload: JSON.parse(row.payload),
          updatedAt: row.updated_at,
        }
      : {
          slot,
          revision: null,
          sequence: 0,
          payload: EMPTY_DRAFT,
          updatedAt: 0,
        };
  }
  private ownerEpoch(owner: string): string {
    const current = this.sql(
      "SELECT epoch FROM draft_owners WHERE owner=?",
    ).get<{ epoch: string }>(owner);
    if (current) return current.epoch;
    const epoch = randomUUID();
    this.sql("INSERT INTO draft_owners(owner,epoch) VALUES(?,?)").run(
      owner,
      epoch,
    );
    return epoch;
  }
  private sign(
    owner: string,
    slot: DraftSlot,
    revision: string | null,
    expires: number,
  ): string {
    return createHmac("sha256", this.secret)
      .update(
        JSON.stringify([
          owner,
          this.ownerEpoch(owner),
          draftSlotKey(slot),
          revision,
          expires,
        ]),
      )
      .digest("hex");
  }
  read(owner: string, slot: DraftSlot): DraftRead {
    const snapshot = this.snapshot(owner, slot);
    const expires = this.now() + 10 * 60_000;
    return {
      snapshot,
      ticket: `${expires}.${this.sign(owner, slot, snapshot.revision, expires)}`,
    };
  }
  private validTicket(owner: string, write: DraftWrite): boolean {
    const [expiry, signature] = write.ticket.split(".");
    const expires = Number(expiry);
    if (
      !signature ||
      !Number.isSafeInteger(expires) ||
      expires < this.now() ||
      expires > this.now() + 10 * 60_000
    )
      return false;
    const expected = this.sign(owner, write.slot, write.baseRevision, expires);
    return (
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    );
  }
  write(owner: string, write: DraftWrite): DraftWriteResult {
    const request = createHash("sha256")
      .update(JSON.stringify(write))
      .digest("hex");
    let changed = false;
    const result = this.db.transaction(() => {
      const receipt = this.sql(
        "SELECT request,response FROM draft_receipts WHERE owner=? AND operation=? AND created_at>=?",
      ).get<{ request: string; response: string }>(
        owner,
        write.operationId,
        this.now() - RETENTION,
      );
      if (receipt) {
        if (receipt.request !== request)
          throw new Error("Operation ID reused with different content");
        const result = JSON.parse(receipt.response) as DraftWriteResult;
        result.snapshot.payload = write.payload;
        return result;
      }
      const current = this.read(owner, write.slot);
      const reply = (
        outcome: DraftWriteResult["outcome"],
      ): DraftWriteResult => ({
        ...current,
        outcome,
        operationId: write.operationId,
      });
      if (!this.validTicket(owner, write)) return reply("expired");
      if (current.snapshot.revision !== write.baseRevision)
        return reply("conflict");
      const bytes = Buffer.byteLength(JSON.stringify(write.payload));
      if (bytes > DRAFT_MAX_BYTES) throw new Error("Draft exceeds 256 KiB");
      const totals = this.sql(
        "SELECT count(*) AS count,coalesce(sum(length(CAST(payload AS BLOB))),0) AS bytes FROM drafts WHERE owner=?",
      ).get<{ count: number; bytes: number }>(owner);
      if ((totals?.count ?? 0) >= 4096 && !current.snapshot.revision)
        throw new Error("Draft slot limit reached");
      if (
        (totals?.bytes ?? 0) +
          bytes -
          (current.snapshot.revision
            ? Buffer.byteLength(JSON.stringify(current.snapshot.payload))
            : 0) >
        32 * 1024 * 1024
      )
        throw new Error("Draft storage limit reached");
      const receiptCount =
        this.sql(
          "SELECT count(*) AS count FROM draft_receipts WHERE owner=?",
        ).get<{ count: number }>(owner)?.count ?? 0;
      // Refuse rather than evict live retry evidence. Cleanup reclaims expired receipts.
      if (receiptCount >= 20_000) {
        this.sql(
          "DELETE FROM draft_receipts WHERE (owner,operation) IN (SELECT owner,operation FROM draft_receipts WHERE owner=? AND created_at<? ORDER BY created_at LIMIT 1000)",
        ).run(owner, this.now() - 10 * 60_000);
        if (
          (this.sql(
            "SELECT count(*) AS count FROM draft_receipts WHERE owner=?",
          ).get<{ count: number }>(owner)?.count ?? 0) >= 20_000
        )
          throw new Error("Draft receipt limit reached");
      }
      if (!draftPayloadEqual(current.snapshot.payload, write.payload)) {
        const key = draftSlotKey(write.slot);
        if (write.recovery && draftHasContent(current.snapshot.payload))
          this.retainRecovery(owner, key, current.snapshot.payload);
        this.sql("UPDATE draft_meta SET sequence=sequence+1 WHERE id=1").run();
        this.sql(
          "UPDATE draft_owners SET sequence=sequence+1 WHERE owner=?",
        ).run(owner);
        const sequence = this.sequence(owner);
        this.sql(
          "INSERT INTO drafts(owner,slot,slot_json,revision,sequence,payload,updated_at,empty) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner,slot) DO UPDATE SET revision=excluded.revision,sequence=excluded.sequence,payload=excluded.payload,updated_at=excluded.updated_at,empty=excluded.empty",
        ).run(
          owner,
          key,
          JSON.stringify(write.slot),
          randomUUID(),
          sequence,
          JSON.stringify(write.payload),
          this.now(),
          draftHasContent(write.payload) ? 0 : 1,
        );
        // Released references remain protected through the staging grace period.
        this.sql(
          "UPDATE draft_files SET expires_at=? WHERE owner=? AND slot=? AND expires_at=?",
        ).run(this.now() + GRACE, owner, key, LIVE);
        for (const ref of write.payload.attachments)
          this.sql(
            "INSERT INTO draft_files(owner,slot,attachment,expires_at) VALUES(?,?,?,?) ON CONFLICT(owner,slot,attachment) DO UPDATE SET expires_at=excluded.expires_at",
          ).run(owner, key, ref.id, LIVE);
        changed = true;
      }
      const accepted: DraftWriteResult = {
        ...this.read(owner, write.slot),
        outcome: "accepted",
        operationId: write.operationId,
      };
      this.sql(
        "INSERT INTO draft_receipts(owner,operation,request,response,created_at) VALUES(?,?,?,?,?)",
      ).run(
        owner,
        write.operationId,
        request,
        JSON.stringify({
          ...accepted,
          snapshot: { ...accepted.snapshot, payload: undefined },
        }),
        this.now(),
      );
      return accepted;
    });
    if (changed)
      for (const listener of this.listeners.get(owner) ?? []) listener();
    return result;
  }
  private retainRecovery(
    owner: string,
    slot: string,
    payload: DraftPayload,
  ): void {
    this.sql(
      "INSERT INTO draft_recovery(owner,slot,payload,created_at) VALUES(?,?,?,?)",
    ).run(owner, slot, JSON.stringify(payload), this.now());
    this.sql(
      "DELETE FROM draft_recovery WHERE owner=? AND slot=? AND id NOT IN (SELECT id FROM draft_recovery WHERE owner=? AND slot=? ORDER BY id DESC LIMIT 5)",
    ).run(owner, slot, owner, slot);
    // An account-wide 128-copy ceiling bounds hidden history independently of live slots.
    this.sql(
      "DELETE FROM draft_recovery WHERE owner=? AND id NOT IN (SELECT id FROM draft_recovery WHERE owner=? ORDER BY id DESC LIMIT 128)",
    ).run(owner, owner);
  }
  recovery(owner: string, slot: DraftSlot): DraftPayload[] {
    return this.sql(
      "SELECT payload FROM draft_recovery WHERE owner=? AND slot=? AND created_at>=? ORDER BY id DESC LIMIT 5",
    )
      .all<{ payload: string }>(owner, draftSlotKey(slot), this.now() - GRACE)
      .map((r) => JSON.parse(r.payload));
  }
  sequence(owner?: string): number {
    if (owner !== undefined)
      return (
        this.sql("SELECT sequence FROM draft_owners WHERE owner=?").get<{
          sequence: number;
        }>(owner)?.sequence ?? 0
      );
    return (
      this.sql("SELECT sequence FROM draft_meta WHERE id=1").get<{
        sequence: number;
      }>()?.sequence ?? 0
    );
  }
  list(
    owner: string,
    after: string,
    since?: number,
  ): Array<{
    slot: DraftSlot;
    revision: string;
    sequence: number;
    empty: boolean;
  }> {
    const statement =
      since === undefined
        ? this.sql(
            "SELECT slot_json,revision,sequence,empty FROM drafts WHERE owner=? AND slot>? ORDER BY slot LIMIT 100",
          )
        : this.sql(
            "SELECT slot_json,revision,sequence,empty FROM drafts INDEXED BY drafts_changes WHERE owner=? AND sequence>? AND slot>? ORDER BY slot LIMIT 100",
          );
    return statement
      .all<{
        slot_json: string;
        revision: string;
        sequence: number;
        empty: number;
      }>(...(since === undefined ? [owner, after] : [owner, since, after]))
      .map((r) => ({
        slot: JSON.parse(r.slot_json),
        revision: r.revision,
        sequence: r.sequence,
        empty: !!r.empty,
      }));
  }
  protects(owner: string, id: string): boolean {
    return !!this.sql(
      "SELECT 1 FROM draft_files WHERE owner=? AND attachment=? AND expires_at>? LIMIT 1",
    ).get(owner, id, this.now());
  }
  subscribe(owner: string, listener: () => void): () => void {
    let set = this.listeners.get(owner);
    if (!set) {
      set = new Set();
      this.listeners.set(owner, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(owner);
    };
  }
  cleanup(): void {
    // Each statement is bounded; a busy installation catches up over later ticks.
    this.db.transaction(() => {
      this.sql(
        "DELETE FROM draft_receipts WHERE (owner,operation) IN (SELECT owner,operation FROM draft_receipts WHERE created_at<? LIMIT 200)",
      ).run(this.now() - RETENTION);
      this.sql(
        "DELETE FROM drafts WHERE (owner,slot) IN (SELECT owner,slot FROM drafts WHERE empty=1 AND updated_at<? LIMIT 200)",
      ).run(this.now() - RETENTION);
      this.sql(
        "DELETE FROM draft_recovery WHERE id IN (SELECT id FROM draft_recovery WHERE created_at<? LIMIT 200)",
      ).run(this.now() - GRACE);
      this.sql(
        "DELETE FROM draft_files WHERE (owner,slot,attachment) IN (SELECT owner,slot,attachment FROM draft_files WHERE expires_at<? LIMIT 200)",
      ).run(this.now());
    });
  }
  deleteOwner(owner: string): void {
    this.db.transaction(() => {
      this.sql("DELETE FROM drafts WHERE owner=?").run(owner);
      this.sql("DELETE FROM draft_receipts WHERE owner=?").run(owner);
      this.sql("DELETE FROM draft_recovery WHERE owner=?").run(owner);
      this.sql("DELETE FROM draft_files WHERE owner=?").run(owner);
      this.sql("DELETE FROM draft_owners WHERE owner=?").run(owner);
      this.sql("UPDATE draft_meta SET sequence=sequence+1 WHERE id=1").run();
    });
    for (const listener of this.listeners.get(owner) ?? []) listener();
  }
  close(): void {
    // Release long-poll waiters while their final sequence is still readable.
    for (const listeners of this.listeners.values())
      for (const listener of [...listeners]) listener();
    for (const stmt of this.statements.values()) stmt.finalize();
    this.statements.clear();
    this.listeners.clear();
  }
}
