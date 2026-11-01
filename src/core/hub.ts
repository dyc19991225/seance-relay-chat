import { EventEmitter } from "node:events";
import { type IrcMessage, ircLower, isValidChannel, isValidNick } from "../irc/message.js";
import { ERR, RPL } from "../irc/numerics.js";
import type { Client, HistoryEntry, HistoryKind, HistorySink } from "./types.js";

export interface Channel {
  name: string;
  topic: string;
  topicBy: string;
  topicAt: number;
  createdAt: number;
  members: Set<Client>;
  persistent: boolean;
}

export interface HubOptions {
  serverName: string;
  networkName: string;
  version?: string;
  motd?: string[];
  defaultChannels?: string[];
  history?: HistorySink;
  /** Messages allowed per client in a burst before throttling (token bucket). */
  floodBurst?: number;
  /** Tokens refilled per second. */
  floodRefillPerSec?: number;
}

interface Bucket {
  tokens: number;
  updated: number;
}

/**
 * ChatHub is the transport-independent IRC state machine: it owns nicks,
 * channels and topics and implements the command semantics of RFC 1459/2812.
 */
export class ChatHub extends EventEmitter {
  readonly serverName: string;
  readonly networkName: string;
  readonly version: string;
  readonly createdAt = new Date();
  private readonly motd: string[];
  private readonly history?: HistorySink;
  private readonly clients = new Set<Client>();
  private readonly nicks = new Map<string, Client>();
  private readonly channels = new Map<string, Channel>();
  private readonly buckets = new WeakMap<Client, Bucket>();
  private readonly floodBurst: number;
  private readonly floodRefill: number;

  constructor(opts: HubOptions) {
    super();
    this.serverName = opts.serverName;
    this.networkName = opts.networkName;
    this.version = opts.version ?? "seance-0.1.0";
    this.motd = opts.motd ?? ["Welcome to the seance. The dead protocol speaks again."];
    if (opts.history) this.history = opts.history;
    this.floodBurst = opts.floodBurst ?? 20;
    this.floodRefill = opts.floodRefillPerSec ?? 2;
    for (const ch of opts.defaultChannels ?? []) {
      if (isValidChannel(ch)) this.ensureChannel(ch, true);
    }
  }

  // ---------------------------------------------------------------- lookup

  getChannel(name: string): Channel | undefined {
    return this.channels.get(ircLower(name));
  }

  listChannels(): Channel[] {
    return [...this.channels.values()];
  }

  getClientByNick(nick: string): Client | undefined {
    return this.nicks.get(ircLower(nick));
  }

  clientCount(): number {
    return this.clients.size;
  }

  recentHistory(channel: string, limit: number): HistoryEntry[] {
    return this.history ? this.history.recent(channel, limit) : [];
  }

  prefixOf(c: Client): string {
    return `${c.nick ?? "*"}!${c.username ?? "unknown"}@${c.host}`;
  }

  // ------------------------------------------------------------ lifecycle

  attach(client: Client): void {
    this.clients.add(client);
  }

  /** Remove a client and announce its departure (QUIT) to shared channels. */
  detach(client: Client, reason: string): void {
    if (!this.clients.has(client)) return;
    this.clients.delete(client);
    if (client.registered && client.nick) {
      const quit: IrcMessage = { prefix: this.prefixOf(client), command: "QUIT", params: [reason] };
      const peers = this.peersOf(client);
      for (const p of peers) p.send(quit);
      for (const key of client.channels) {
        const ch = this.channels.get(key);
        if (!ch) continue;
        ch.members.delete(client);
        this.record(ch.name, client.nick, "quit", reason);
        this.maybeDropChannel(ch);
      }
      this.nicks.delete(ircLower(client.nick));
    }
    client.channels.clear();
    this.emit("detach", client);
  }

  // -------------------------------------------------------------- dispatch

  handle(client: Client, msg: IrcMessage): void {
    client.lastActivity = Date.now();
    const cmd = msg.command;

    if (!client.registered && !["NICK", "USER", "PASS", "CAP", "PING", "PONG", "QUIT"].includes(cmd)) {
      this.numeric(client, ERR.NOTREGISTERED, ["You have not registered"]);
      return;
    }
    if ((cmd === "PRIVMSG" || cmd === "NOTICE") && !this.takeToken(client)) {
      this.serverNotice(client, "Flood protection: slow down, the spirits are tired.");
      return;
    }

    switch (cmd) {
      case "CAP": return this.onCap(client, msg);
      case "PASS": return; // no server password support; accepted and ignored
      case "NICK": return this.onNick(client, msg);
      case "USER": return this.onUser(client, msg);
      case "PING": return this.onPing(client, msg);
      case "PONG": return;
      case "JOIN": return this.onJoin(client, msg);
      case "PART": return this.onPart(client, msg);
      case "PRIVMSG": return this.onMessage(client, msg, false);
      case "NOTICE": return this.onMessage(client, msg, true);
      case "TOPIC": return this.onTopic(client, msg);
      case "NAMES": return this.onNames(client, msg);
      case "LIST": return this.onList(client);
      case "WHO": return this.onWho(client, msg);
      case "MODE": return this.onMode(client, msg);
      case "MOTD": return this.sendMotd(client);
      case "QUIT": return this.onQuit(client, msg);
      default:
        this.numeric(client, ERR.UNKNOWNCOMMAND, [cmd, "Unknown command"]);
    }
  }

  // -------------------------------------------------------------- commands

  private onCap(client: Client, msg: IrcMessage): void {
    const sub = (msg.params[0] ?? "").toUpperCase();
    const nick = client.nick ?? "*";
    if (sub === "LS" || sub === "LIST") {
      client.send({ prefix: this.serverName, command: "CAP", params: [nick, sub, ""] });
    } else if (sub === "REQ") {
      client.send({ prefix: this.serverName, command: "CAP", params: [nick, "NAK", msg.params[1] ?? ""] });
    }
    // CAP END and anything else: nothing to do, we never suspend registration.
  }

  private onNick(client: Client, msg: IrcMessage): void {
    const wanted = msg.params[0];
    if (!wanted) return this.numeric(client, ERR.NONICKNAMEGIVEN, ["No nickname given"]);
    if (!isValidNick(wanted)) return this.numeric(client, ERR.ERRONEUSNICKNAME, [wanted, "Erroneous nickname"]);
    const key = ircLower(wanted);
    const holder = this.nicks.get(key);
    if (holder && holder !== client) {
      return this.numeric(client, ERR.NICKNAMEINUSE, [wanted, "Nickname is already in use"]);
    }
    const old = client.nick;
    if (client.registered && old) {
      if (old === wanted) return;
      const change: IrcMessage = { prefix: this.prefixOf(client), command: "NICK", params: [wanted] };
      const audience = this.peersOf(client);
      audience.add(client);
      this.nicks.delete(ircLower(old));
      this.nicks.set(key, client);
      client.nick = wanted;
      for (const c of audience) c.send(change);
      for (const chKey of client.channels) {
        const ch = this.channels.get(chKey);
        if (ch) this.record(ch.name, old, "nick", wanted);
      }
      return;
    }
    if (old) this.nicks.delete(ircLower(old));
    client.nick = wanted;
    this.nicks.set(key, client);
    this.tryRegister(client);
  }

  private onUser(client: Client, msg: IrcMessage): void {
    if (client.registered) return this.numeric(client, ERR.ALREADYREGISTRED, ["You may not reregister"]);
    if (msg.params.length < 4) return this.numeric(client, ERR.NEEDMOREPARAMS, ["USER", "Not enough parameters"]);
    const username = (msg.params[0] ?? "").replace(/[^A-Za-z0-9_\-.]/g, "").slice(0, 16) || "user";
    client.username = "~" + username;
    client.realname = (msg.params[3] ?? "").slice(0, 64);
    this.tryRegister(client);
  }

  private tryRegister(client: Client): void {
    if (client.registered || !client.nick || !client.username) return;
    client.registered = true;
    const n = client.nick;
    this.numeric(client, RPL.WELCOME, [`Welcome to the ${this.networkName} IRC network, ${this.prefixOf(client)}`]);
    this.numeric(client, RPL.YOURHOST, [`Your host is ${this.serverName}, running version ${this.version}`]);
    this.numeric(client, RPL.CREATED, [`This server was raised from the grave on ${this.createdAt.toUTCString()}`]);
    client.send({ prefix: this.serverName, command: RPL.MYINFO, params: [n, this.serverName, this.version, "i", "nt"] });
    this.numeric(client, RPL.ISUPPORT, [
      `NETWORK=${this.networkName}`,
      "CASEMAPPING=rfc1459",
      "CHANTYPES=#",
      "NICKLEN=20",
      "CHANNELLEN=50",
      "PREFIX=()",
      "are supported by this server",
    ]);
    this.sendMotd(client);
    this.emit("register", client);
  }

  private sendMotd(client: Client): void {
    this.numeric(client, RPL.MOTDSTART, [`- ${this.serverName} Message of the day -`]);
    for (const line of this.motd) this.numeric(client, RPL.MOTD, [`- ${line}`]);
    this.numeric(client, RPL.ENDOFMOTD, ["End of MOTD command"]);
  }

  private onPing(client: Client, msg: IrcMessage): void {
    const token = msg.params[0];
    if (token === undefined) return this.numeric(client, ERR.NEEDMOREPARAMS, ["PING", "Not enough parameters"]);
    client.send({ prefix: this.serverName, command: "PONG", params: [this.serverName, token] });
  }

  private onJoin(client: Client, msg: IrcMessage): void {
    const target = msg.params[0];
    if (!target) return this.numeric(client, ERR.NEEDMOREPARAMS, ["JOIN", "Not enough parameters"]);
    if (target === "0") {
      for (const key of [...client.channels]) {
        const ch = this.channels.get(key);
        if (ch) this.partChannel(client, ch, "Left all channels");
      }
      return;
    }
    for (const name of target.split(",")) {
      if (!isValidChannel(name)) {
        this.numeric(client, ERR.NOSUCHCHANNEL, [name, "No such channel"]);
        continue;
      }
      const ch = this.ensureChannel(name, false);
      if (ch.members.has(client)) continue;
      ch.members.add(client);
      client.channels.add(ircLower(ch.name));
      const join: IrcMessage = { prefix: this.prefixOf(client), command: "JOIN", params: [ch.name] };
      for (const m of ch.members) m.send(join);
      this.record(ch.name, client.nick!, "join", "");
      if (ch.topic) this.sendTopic(client, ch);
      this.sendNames(client, ch);
      this.emit("join", client, ch);
    }
  }

  private onPart(client: Client, msg: IrcMessage): void {
    const target = msg.params[0];
    if (!target) return this.numeric(client, ERR.NEEDMOREPARAMS, ["PART", "Not enough parameters"]);
    const reason = msg.params[1] ?? "";
    for (const name of target.split(",")) {
      const ch = this.getChannel(name);
      if (!ch) {
        this.numeric(client, ERR.NOSUCHCHANNEL, [name, "No such channel"]);
        continue;
      }
      if (!ch.members.has(client)) {
        this.numeric(client, ERR.NOTONCHANNEL, [ch.name, "You're not on that channel"]);
        continue;
      }
      this.partChannel(client, ch, reason);
    }
  }

  private partChannel(client: Client, ch: Channel, reason: string): void {
    const params = reason ? [ch.name, reason] : [ch.name];
    const part: IrcMessage = { prefix: this.prefixOf(client), command: "PART", params };
    for (const m of ch.members) m.send(part);
    ch.members.delete(client);
    client.channels.delete(ircLower(ch.name));
    this.record(ch.name, client.nick!, "part", reason);
    this.maybeDropChannel(ch);
  }

  private onMessage(client: Client, msg: IrcMessage, isNotice: boolean): void {
    const cmd = isNotice ? "NOTICE" : "PRIVMSG";
    const target = msg.params[0];
    const text = msg.params[1];
    // RFC 2812 3.3.2: automatic replies must never be sent in response to a NOTICE.
    const err = (code: string, params: string[]) => {
      if (!isNotice) this.numeric(client, code, params);
    };
    if (!target) return err(ERR.NORECIPIENT, [`No recipient given (${cmd})`]);
    if (text === undefined || text === "") return err(ERR.NOTEXTTOSEND, ["No text to send"]);

    for (const t of target.split(",")) {
      const out: IrcMessage = { prefix: this.prefixOf(client), command: cmd, params: [t, text] };
      if (t.startsWith("#")) {
        const ch = this.getChannel(t);
        if (!ch) {
          err(ERR.NOSUCHNICK, [t, "No such nick/channel"]);
          continue;
        }
        if (!ch.members.has(client)) {
          err(ERR.CANNOTSENDTOCHAN, [ch.name, "Cannot send to channel (you must join first)"]);
          continue;
        }
        out.params[0] = ch.name;
        for (const m of ch.members) if (m !== client) m.send(out);
        const action = /^\x01ACTION (.*)\x01?$/.exec(text);
        const kind: HistoryKind = action ? "action" : isNotice ? "notice" : "msg";
        this.record(ch.name, client.nick!, kind, action ? action[1]!.replace(/\x01$/, "") : text);
        this.emit("message", { from: client, channel: ch, text, notice: isNotice });
      } else {
        const peer = this.getClientByNick(t);
        if (!peer) {
          err(ERR.NOSUCHNICK, [t, "No such nick/channel"]);
          continue;
        }
        peer.send(out);
      }
    }
  }

  private onTopic(client: Client, msg: IrcMessage): void {
    const name = msg.params[0];
    if (!name) return this.numeric(client, ERR.NEEDMOREPARAMS, ["TOPIC", "Not enough parameters"]);
    const ch = this.getChannel(name);
    if (!ch) return this.numeric(client, ERR.NOSUCHCHANNEL, [name, "No such channel"]);
    if (msg.params.length < 2) {
      if (!ch.topic) return this.numeric(client, RPL.NOTOPIC, [ch.name, "No topic is set"]);
      return this.sendTopic(client, ch);
    }
    if (!ch.members.has(client)) return this.numeric(client, ERR.NOTONCHANNEL, [ch.name, "You're not on that channel"]);
    ch.topic = (msg.params[1] ?? "").slice(0, 300);
    ch.topicBy = this.prefixOf(client);
    ch.topicAt = Math.floor(Date.now() / 1000);
    const out: IrcMessage = { prefix: this.prefixOf(client), command: "TOPIC", params: [ch.name, ch.topic] };
    for (const m of ch.members) m.send(out);
    this.record(ch.name, client.nick!, "topic", ch.topic);
  }

  private sendTopic(client: Client, ch: Channel): void {
    this.numeric(client, RPL.TOPIC, [ch.name, ch.topic]);
    client.send({
      prefix: this.serverName,
      command: RPL.TOPICWHOTIME,
      params: [client.nick ?? "*", ch.name, ch.topicBy, String(ch.topicAt)],
    });
  }

  private onNames(client: Client, msg: IrcMessage): void {
    const target = msg.params[0];
    if (!target) {
      for (const ch of this.channels.values()) this.sendNames(client, ch, false);
      return this.numeric(client, RPL.ENDOFNAMES, ["*", "End of /NAMES list"]);
    }
    for (const name of target.split(",")) {
      const ch = this.getChannel(name);
      if (ch) this.sendNames(client, ch);
      else this.numeric(client, RPL.ENDOFNAMES, [name, "End of /NAMES list"]);
    }
  }

  private sendNames(client: Client, ch: Channel, withEnd = true): void {
    const nicks = [...ch.members].map((m) => m.nick!).filter(Boolean);
    // Keep each 353 line comfortably under 512 bytes.
    let batch: string[] = [];
    const flush = () => {
      if (batch.length) this.numeric(client, RPL.NAMREPLY, ["=", ch.name, batch.join(" ")]);
      batch = [];
    };
    for (const n of nicks) {
      if (batch.join(" ").length + n.length > 380) flush();
      batch.push(n);
    }
    flush();
    if (withEnd) this.numeric(client, RPL.ENDOFNAMES, [ch.name, "End of /NAMES list"]);
  }

  private onList(client: Client): void {
    this.numeric(client, RPL.LISTSTART, ["Channel", "Users  Name"]);
    for (const ch of this.channels.values()) {
      this.numeric(client, RPL.LIST, [ch.name, String(ch.members.size), ch.topic]);
    }
    this.numeric(client, RPL.LISTEND, ["End of /LIST"]);
  }

  private onWho(client: Client, msg: IrcMessage): void {
    const mask = msg.params[0] ?? "*";
    const ch = mask.startsWith("#") ? this.getChannel(mask) : undefined;
    const people = ch ? [...ch.members] : [this.getClientByNick(mask)].filter((c): c is Client => !!c);
    for (const p of people) {
      this.numeric(client, RPL.WHOREPLY, [
        ch?.name ?? "*", p.username ?? "~u", p.host, this.serverName, p.nick ?? "*", "H", `0 ${p.realname ?? ""}`,
      ]);
    }
    this.numeric(client, RPL.ENDOFWHO, [mask, "End of WHO list"]);
  }

  private onMode(client: Client, msg: IrcMessage): void {
    const target = msg.params[0];
    if (!target) return this.numeric(client, ERR.NEEDMOREPARAMS, ["MODE", "Not enough parameters"]);
    if (target.startsWith("#")) {
      const ch = this.getChannel(target);
      if (!ch) return this.numeric(client, ERR.NOSUCHCHANNEL, [target, "No such channel"]);
      if (msg.params.length === 1) this.numeric(client, RPL.CHANNELMODEIS, [ch.name, "+nt"]);
      // Mode changes are not supported in this minimal server; silently ignored.
      return;
    }
    if (client.nick && ircLower(target) === ircLower(client.nick)) {
      this.numeric(client, RPL.UMODEIS, ["+i"]);
    }
  }

  private onQuit(client: Client, msg: IrcMessage): void {
    const reason = msg.params[0] ? `Quit: ${msg.params[0]}` : "Quit";
    client.send({ command: "ERROR", params: [`Closing Link: ${client.host} (${reason})`] });
    this.detach(client, reason);
    client.close(reason);
  }

  // ---------------------------------------------------------------- helpers

  private ensureChannel(name: string, persistent: boolean): Channel {
    const key = ircLower(name);
    let ch = this.channels.get(key);
    if (!ch) {
      ch = { name, topic: "", topicBy: "", topicAt: 0, createdAt: Date.now(), members: new Set(), persistent };
      this.channels.set(key, ch);
    }
    if (persistent) ch.persistent = true;
    return ch;
  }

  private maybeDropChannel(ch: Channel): void {
    if (ch.members.size === 0 && !ch.persistent) this.channels.delete(ircLower(ch.name));
  }

  private peersOf(client: Client): Set<Client> {
    const out = new Set<Client>();
    for (const key of client.channels) {
      const ch = this.channels.get(key);
      if (!ch) continue;
      for (const m of ch.members) if (m !== client) out.add(m);
    }
    return out;
  }

  numeric(client: Client, code: string, params: string[]): void {
    client.send({ prefix: this.serverName, command: code, params: [client.nick ?? "*", ...params] });
  }

  serverNotice(client: Client, text: string): void {
    client.send({ prefix: this.serverName, command: "NOTICE", params: [client.nick ?? "*", text] });
  }

  private record(channel: string, nick: string, kind: HistoryKind, text: string): void {
    if (!this.history) return;
    try {
      this.history.record({ ts: Date.now(), channel, nick, kind, text });
    } catch (e) {
      this.emit("error-log", e);
    }
  }

  private takeToken(client: Client): boolean {
    if (client.kind === "bot") return true;
    const now = Date.now();
    const b = this.buckets.get(client) ?? { tokens: this.floodBurst, updated: now };
    b.tokens = Math.min(this.floodBurst, b.tokens + ((now - b.updated) / 1000) * this.floodRefill);
    b.updated = now;
    this.buckets.set(client, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}
