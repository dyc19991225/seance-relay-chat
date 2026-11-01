import type { IrcMessage } from "../irc/message.js";
import { parseMessage } from "../irc/message.js";
import type { HistoryEntry } from "../core/types.js";

/**
 * JSON protocol spoken between the browser client and the server.
 * The bridge translates it to and from IRC messages so that web users and
 * TCP IRC users share the exact same channels through the same hub.
 */
export type WsCommand =
  | { type: "hello"; nick: string; realname?: string }
  | { type: "join"; channel: string }
  | { type: "part"; channel: string; reason?: string }
  | { type: "msg"; target: string; text: string }
  | { type: "action"; target: string; text: string }
  | { type: "notice"; target: string; text: string }
  | { type: "topic"; channel: string; topic?: string }
  | { type: "nick"; nick: string }
  | { type: "names"; channel: string }
  | { type: "list" }
  | { type: "raw"; line: string }
  | { type: "quit"; reason?: string };

export type WsEvent =
  | { type: "welcome"; nick: string; text: string; network?: string }
  | { type: "message"; from: string; target: string; text: string; notice: boolean; action: boolean; ts: number }
  | { type: "join"; nick: string; channel: string; ts: number }
  | { type: "part"; nick: string; channel: string; reason: string; ts: number }
  | { type: "quit"; nick: string; reason: string; ts: number }
  | { type: "nick"; from: string; to: string; ts: number }
  | { type: "topic"; channel: string; topic: string; by?: string; ts: number }
  | { type: "names"; channel: string; nicks: string[] }
  | { type: "list"; channels: Array<{ name: string; users: number; topic: string }> }
  | { type: "history"; channel: string; entries: HistoryEntry[] }
  | { type: "error"; code: string; text: string }
  | { type: "server"; command: string; text: string };

const MAX_TEXT = 400;

function clip(s: unknown, n = MAX_TEXT): string {
  return String(s ?? "").replace(/[\r\n\0]/g, " ").slice(0, n);
}

/** Translate a browser command into zero or more IRC messages. Throws on invalid input. */
export function wsCommandToIrc(cmd: WsCommand): IrcMessage[] {
  switch (cmd.type) {
    case "hello": {
      const nick = clip(cmd.nick, 20);
      return [
        { command: "NICK", params: [nick] },
        { command: "USER", params: [nick.replace(/[^A-Za-z0-9_]/g, "") || "web", "0", "*", clip(cmd.realname || "web visitor", 64)] },
      ];
    }
    case "join": return [{ command: "JOIN", params: [clip(cmd.channel, 50)] }];
    case "part": return [{ command: "PART", params: cmd.reason ? [clip(cmd.channel, 50), clip(cmd.reason)] : [clip(cmd.channel, 50)] }];
    case "msg": return [{ command: "PRIVMSG", params: [clip(cmd.target, 50), clip(cmd.text)] }];
    case "action": return [{ command: "PRIVMSG", params: [clip(cmd.target, 50), `\x01ACTION ${clip(cmd.text)}\x01`] }];
    case "notice": return [{ command: "NOTICE", params: [clip(cmd.target, 50), clip(cmd.text)] }];
    case "topic":
      return [{ command: "TOPIC", params: cmd.topic === undefined ? [clip(cmd.channel, 50)] : [clip(cmd.channel, 50), clip(cmd.topic, 300)] }];
    case "nick": return [{ command: "NICK", params: [clip(cmd.nick, 20)] }];
    case "names": return [{ command: "NAMES", params: [clip(cmd.channel, 50)] }];
    case "list": return [{ command: "LIST", params: [] }];
    case "raw": {
      const m = parseMessage(clip(cmd.line, 510));
      if (!m) throw new Error("Unparseable IRC line");
      return [m];
    }
    case "quit": return [{ command: "QUIT", params: cmd.reason ? [clip(cmd.reason)] : [] }];
    default:
      throw new Error("Unknown command type");
  }
}

/** Validate untrusted JSON from the socket. */
export function parseWsCommand(data: string): WsCommand {
  if (data.length > 4096) throw new Error("Frame too large");
  const obj = JSON.parse(data) as unknown;
  if (!obj || typeof obj !== "object" || typeof (obj as { type?: unknown }).type !== "string") {
    throw new Error("Missing type");
  }
  return obj as WsCommand;
}

function nickOf(prefix?: string): string {
  if (!prefix) return "";
  const bang = prefix.indexOf("!");
  return bang === -1 ? prefix : prefix.slice(0, bang);
}

/**
 * Stateful translator from IRC messages (as produced by the hub) to browser events.
 * NAMES replies (353) are accumulated until 366 so the browser gets one list.
 */
export class IrcToWs {
  private pendingNames = new Map<string, string[]>();
  private listing: Array<{ name: string; users: number; topic: string }> = [];

  translate(msg: IrcMessage, now = Date.now()): WsEvent | null {
    const p = msg.params;
    switch (msg.command) {
      case "PRIVMSG":
      case "NOTICE": {
        const raw = p[1] ?? "";
        const action = /^\x01ACTION (.*?)\x01?$/.exec(raw);
        return {
          type: "message", from: nickOf(msg.prefix), target: p[0] ?? "",
          text: action ? action[1]! : raw, notice: msg.command === "NOTICE", action: !!action, ts: now,
        };
      }
      case "JOIN": return { type: "join", nick: nickOf(msg.prefix), channel: p[0] ?? "", ts: now };
      case "PART": return { type: "part", nick: nickOf(msg.prefix), channel: p[0] ?? "", reason: p[1] ?? "", ts: now };
      case "QUIT": return { type: "quit", nick: nickOf(msg.prefix), reason: p[0] ?? "", ts: now };
      case "NICK": return { type: "nick", from: nickOf(msg.prefix), to: p[0] ?? "", ts: now };
      case "TOPIC": return { type: "topic", channel: p[0] ?? "", topic: p[1] ?? "", by: nickOf(msg.prefix), ts: now };
      case "001": return { type: "welcome", nick: p[0] ?? "", text: p[1] ?? "" };
      case "332": return { type: "topic", channel: p[1] ?? "", topic: p[2] ?? "", ts: now };
      case "331": return { type: "topic", channel: p[1] ?? "", topic: "", ts: now };
      case "353": {
        const ch = p[2] ?? "";
        const list = this.pendingNames.get(ch) ?? [];
        list.push(...(p[3] ?? "").split(" ").filter(Boolean));
        this.pendingNames.set(ch, list);
        return null;
      }
      case "366": {
        const ch = p[1] ?? "";
        const nicks = this.pendingNames.get(ch) ?? [];
        this.pendingNames.delete(ch);
        if (ch === "*") return null;
        return { type: "names", channel: ch, nicks };
      }
      case "321": this.listing = []; return null;
      case "322": this.listing.push({ name: p[1] ?? "", users: Number(p[2] ?? 0), topic: p[3] ?? "" }); return null;
      case "323": { const channels = this.listing; this.listing = []; return { type: "list", channels }; }
      case "PING": case "PONG": case "CAP": case "333": case "004": case "005":
      case "352": case "315": case "324": case "221":
        return null;
      case "ERROR": return { type: "error", code: "ERROR", text: p[0] ?? "" };
      default:
        if (/^[45]\d\d$/.test(msg.command)) {
          return { type: "error", code: msg.command, text: p.slice(1).join(" ") };
        }
        return { type: "server", command: msg.command, text: p.slice(1).join(" ") };
    }
  }
}
