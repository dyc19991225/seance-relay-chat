import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { ircLower } from "../irc/message.js";
import type { HistoryEntry, HistoryKind, HistorySink } from "../core/types.js";

/**
 * Channel history persisted in SQLite (Node's built-in node:sqlite driver,
 * so there is no native addon to compile).
 */
export class SqliteHistory implements HistorySink {
  private readonly db: DatabaseSync;
  private readonly insertStmt: StatementSync;
  private readonly recentStmt: StatementSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS messages (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        ts      INTEGER NOT NULL,
        channel TEXT    NOT NULL,
        chan_key TEXT   NOT NULL,
        nick    TEXT    NOT NULL,
        kind    TEXT    NOT NULL,
        text    TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_chan ON messages (chan_key, id);
    `);
    this.insertStmt = this.db.prepare(
      "INSERT INTO messages (ts, channel, chan_key, nick, kind, text) VALUES (?, ?, ?, ?, ?, ?)",
    );
    this.recentStmt = this.db.prepare(
      "SELECT id, ts, channel, nick, kind, text FROM messages WHERE chan_key = ? ORDER BY id DESC LIMIT ?",
    );
  }

  record(e: HistoryEntry): void {
    this.insertStmt.run(e.ts, e.channel, ircLower(e.channel), e.nick, e.kind, e.text);
  }

  /** Most recent `limit` entries for a channel, oldest first. */
  recent(channel: string, limit: number): HistoryEntry[] {
    const rows = this.recentStmt.all(ircLower(channel), Math.max(0, Math.min(limit, 1000))) as Array<{
      id: number; ts: number; channel: string; nick: string; kind: string; text: string;
    }>;
    return rows.reverse().map((r) => ({
      id: Number(r.id), ts: Number(r.ts), channel: r.channel, nick: r.nick, kind: r.kind as HistoryKind, text: r.text,
    }));
  }

  /** Delete entries older than `maxAgeMs`. Returns number of rows removed. */
  prune(maxAgeMs: number): number {
    const res = this.db.prepare("DELETE FROM messages WHERE ts < ?").run(Date.now() - maxAgeMs);
    return Number(res.changes);
  }

  close(): void {
    this.db.close();
  }
}
