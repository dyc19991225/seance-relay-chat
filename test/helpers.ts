import { ChatHub } from "../src/core/hub.js";
import type { Client } from "../src/core/types.js";
import { type IrcMessage, parseMessage, serializeMessage } from "../src/irc/message.js";
import { SqliteHistory } from "../src/store/history.js";

export class FakeClient implements Client {
  static seq = 0;
  readonly id = `fake-${++FakeClient.seq}`;
  readonly kind = "tcp" as const;
  readonly host = "test.spirit";
  nick: string | null = null;
  username: string | null = null;
  realname: string | null = null;
  registered = false;
  channels = new Set<string>();
  lastActivity = Date.now();
  inbox: IrcMessage[] = [];
  closed = false;

  send(msg: IrcMessage): void {
    // Round-trip through the wire format to catch serialization bugs.
    const parsed = parseMessage(serializeMessage(msg));
    if (!parsed) throw new Error("unparseable output: " + serializeMessage(msg));
    this.inbox.push(parsed);
  }
  close(): void { this.closed = true; }
  lines(): string[] { return this.inbox.map(serializeMessage); }
  take(): IrcMessage[] { const out = this.inbox; this.inbox = []; return out; }
  commands(): string[] { return this.inbox.map((m) => m.command); }
}

export function makeHub(withHistory = true) {
  const history = withHistory ? new SqliteHistory(":memory:") : undefined;
  const hub = new ChatHub({
    serverName: "test.server", networkName: "TestNet", defaultChannels: ["#seance"],
    ...(history ? { history } : {}),
  });
  return { hub, history };
}

export function line(hub: ChatHub, c: Client, raw: string): void {
  const m = parseMessage(raw);
  if (!m) throw new Error("bad test line " + raw);
  hub.handle(c, m);
}

export function connect(hub: ChatHub, nick: string): FakeClient {
  const c = new FakeClient();
  hub.attach(c);
  line(hub, c, `NICK ${nick}`);
  line(hub, c, `USER ${nick.toLowerCase()} 0 * :${nick} Test`);
  return c;
}
