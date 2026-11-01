import type { IrcMessage } from "../irc/message.js";

export type ClientKind = "tcp" | "ws" | "bot";

/**
 * A connected user, regardless of transport. TCP clients, WebSocket clients
 * and the AI ghost all implement this interface so the hub treats them alike.
 */
export interface Client {
  readonly id: string;
  readonly kind: ClientKind;
  /** Cloaked host shown in prefixes (we never expose raw IP addresses). */
  readonly host: string;
  nick: string | null;
  username: string | null;
  realname: string | null;
  registered: boolean;
  /** Lower-cased channel keys this client has joined. */
  channels: Set<string>;
  lastActivity: number;
  /** Deliver a message to this client. Must not throw. */
  send(msg: IrcMessage): void;
  /** Close the underlying transport (after the hub has cleaned up). */
  close(reason: string): void;
}

export type HistoryKind = "msg" | "notice" | "action" | "join" | "part" | "quit" | "topic" | "nick";

export interface HistoryEntry {
  id?: number;
  ts: number;
  channel: string;
  nick: string;
  kind: HistoryKind;
  text: string;
}

export interface HistorySink {
  record(entry: HistoryEntry): void;
  recent(channel: string, limit: number): HistoryEntry[];
}
