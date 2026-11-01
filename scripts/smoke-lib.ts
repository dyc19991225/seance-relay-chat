import net from "node:net";
import WebSocket from "ws";

/** Minimal raw-TCP IRC client used by the smoke test and e2e test. */
export class RawIrc {
  private sock: net.Socket;
  private buf = "";
  readonly received: string[] = [];
  private waiters: Array<{ re: RegExp; resolve: (l: string) => void }> = [];

  constructor(host: string, port: number, private readonly log = false) {
    this.sock = net.connect(port, host);
    this.sock.setEncoding("utf8");
    this.sock.on("data", (d: string) => {
      this.buf += d;
      let i: number;
      while ((i = this.buf.indexOf("\r\n")) !== -1) {
        const l = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 2);
        this.received.push(l);
        if (this.log) console.log("  tcp <", l);
        this.waiters = this.waiters.filter((w) => (w.re.test(l) ? (w.resolve(l), false) : true));
      }
    });
  }
  ready(): Promise<void> {
    return new Promise((r, j) => { this.sock.once("connect", () => r()); this.sock.once("error", j); });
  }
  send(line: string): void {
    if (this.log) console.log("  tcp >", line);
    this.sock.write(line + "\r\n");
  }
  wait(re: RegExp, ms = 5000): Promise<string> {
    const hit = this.received.find((l) => re.test(l));
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${re} (tcp)`)), ms);
      this.waiters.push({ re, resolve: (l) => { clearTimeout(t); resolve(l); } });
    });
  }
  close(): void { this.sock.end(); }
}

export class RawWs {
  private ws: WebSocket;
  readonly received: Array<Record<string, unknown>> = [];
  private waiters: Array<{ pred: (e: Record<string, unknown>) => boolean; resolve: (e: Record<string, unknown>) => void }> = [];

  constructor(url: string, private readonly log = false) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (d) => {
      const ev = JSON.parse(d.toString()) as Record<string, unknown>;
      this.received.push(ev);
      if (this.log) console.log("  ws  <", JSON.stringify(ev));
      this.waiters = this.waiters.filter((w) => (w.pred(ev) ? (w.resolve(ev), false) : true));
    });
  }
  ready(): Promise<void> {
    return new Promise((r, j) => { this.ws.once("open", () => r()); this.ws.once("error", j); });
  }
  send(obj: Record<string, unknown>): void {
    if (this.log) console.log("  ws  >", JSON.stringify(obj));
    this.ws.send(JSON.stringify(obj));
  }
  wait(pred: (e: Record<string, unknown>) => boolean, ms = 5000): Promise<Record<string, unknown>> {
    const hit = this.received.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout waiting for ws event")), ms);
      this.waiters.push({ pred, resolve: (e) => { clearTimeout(t); resolve(e); } });
    });
  }
  close(): void { this.ws.close(); }
}

/**
 * Full scenario: a TCP IRC user and a WebSocket user meet in a channel, chat,
 * and get answers from the Ghost. Throws on any failure.
 */
export async function runScenario(host: string, ircPort: number, httpPort: number, channel = "#seance", log = false): Promise<string[]> {
  const notes: string[] = [];
  const irc = new RawIrc(host, ircPort, log);
  await irc.ready();
  irc.send("NICK tcpwitch");
  irc.send("USER tcpwitch 0 * :Raw TCP Witch");
  await irc.wait(/ 001 tcpwitch /);
  notes.push("TCP: registered (001 received)");
  irc.send(`JOIN ${channel}`);
  const names = await irc.wait(/ 353 tcpwitch = /);
  await irc.wait(/ 366 tcpwitch /);
  notes.push(`TCP: joined ${channel}, NAMES -> ${names.split(" :").pop()}`);
  irc.send("PING :are-you-alive");
  await irc.wait(/PONG \S+ :?are-you-alive/);
  notes.push("TCP: PING/PONG ok");

  const web = new RawWs(`ws://${host}:${httpPort}/ws`, log);
  await web.ready();
  web.send({ type: "hello", nick: "webwraith" });
  await web.wait((e) => e.type === "welcome");
  web.send({ type: "join", channel });
  await web.wait((e) => e.type === "names" && e.channel === channel);
  notes.push("WS: registered and joined");
  await irc.wait(/:webwraith!\S+ JOIN #/);
  notes.push("TCP saw WS user JOIN");

  irc.send(`PRIVMSG ${channel} :hello from a raw TCP socket`);
  await web.wait((e) => e.type === "message" && e.from === "tcpwitch" && e.text === "hello from a raw TCP socket");
  notes.push("TCP -> WS message bridged");

  web.send({ type: "msg", target: channel, text: "hello from the browser bridge" });
  await irc.wait(/:webwraith!\S+ PRIVMSG #\S+ :hello from the browser bridge/);
  notes.push("WS -> TCP message bridged");

  irc.send(`PRIVMSG ${channel} :!ask what is IRC?`);
  const ans = await irc.wait(/:Ghost!\S+ PRIVMSG #\S+ :tcpwitch: /, 35_000);
  notes.push(`Ghost answered TCP !ask: ${ans.split(" :").slice(1).join(" :")}`);
  await web.wait((e) => e.type === "message" && e.from === "Ghost" && String(e.text).startsWith("tcpwitch:"));
  notes.push("WS user also saw the Ghost answer");

  web.send({ type: "msg", target: channel, text: "!summary" });
  const sum = await web.wait((e) => e.type === "message" && e.from === "Ghost" && String(e.text).startsWith("webwraith:"), 35_000);
  notes.push(`Ghost answered WS !summary: ${String(sum.text)}`);

  irc.send(`TOPIC ${channel} :IRC is undead`);
  await web.wait((e) => e.type === "topic" && e.topic === "IRC is undead");
  notes.push("TOPIC propagated to WS");

  irc.send("QUIT :back to the grave");
  await web.wait((e) => e.type === "quit" && e.nick === "tcpwitch");
  notes.push("QUIT propagated to WS");
  irc.close();
  web.close();
  return notes;
}
