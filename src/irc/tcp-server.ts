import net from "node:net";
import { cloakHost, newId } from "../core/cloak.js";
import type { ChatHub } from "../core/hub.js";
import type { Client } from "../core/types.js";
import { type IrcMessage, LineBuffer, MAX_LINE_BYTES, parseMessage, serializeMessage, truncateBytes } from "./message.js";

export interface TcpServerOptions {
  host: string;
  port: number;
  cloakSalt: string;
  /** Send PING after this much idle time (ms). */
  pingIntervalMs?: number;
  /** Disconnect after this much idle time (ms). */
  idleTimeoutMs?: number;
  maxConnections?: number;
}

/** A classic IRC client connected over plain TCP (irssi, HexChat, WeeChat, nc...). */
class TcpClient implements Client {
  readonly id = newId();
  readonly kind = "tcp" as const;
  nick: string | null = null;
  username: string | null = null;
  realname: string | null = null;
  registered = false;
  channels = new Set<string>();
  lastActivity = Date.now();
  pinged = false;

  constructor(readonly socket: net.Socket, readonly host: string) {}

  send(msg: IrcMessage): void {
    if (this.socket.destroyed || !this.socket.writable) return;
    this.socket.write(serializeMessage(msg) + "\r\n");
  }

  close(): void {
    if (!this.socket.destroyed) this.socket.end();
    setTimeout(() => this.socket.destroy(), 1000).unref();
  }
}

export function startTcpServer(hub: ChatHub, opts: TcpServerOptions): Promise<net.Server> {
  const pingInterval = opts.pingIntervalMs ?? 90_000;
  const idleTimeout = opts.idleTimeoutMs ?? 240_000;
  const live = new Set<TcpClient>();

  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.setNoDelay(true);
    const client = new TcpClient(socket, cloakHost("irc", socket.remoteAddress, opts.cloakSalt));
    live.add(client);
    hub.attach(client);
    const lines = new LineBuffer();

    socket.on("data", (chunk: string) => {
      for (const raw of lines.push(chunk)) {
        const line = truncateBytes(raw, MAX_LINE_BYTES - 2);
        const msg = parseMessage(line);
        if (!msg) continue;
        client.pinged = false;
        try {
          hub.handle(client, msg);
        } catch (err) {
          console.error("[irc] handler error", err);
        }
      }
    });
    const gone = (reason: string) => {
      live.delete(client);
      hub.detach(client, reason);
    };
    socket.on("close", () => gone("Connection closed"));
    socket.on("error", (err) => gone(`Read error: ${err.message}`));
  });
  if (opts.maxConnections) server.maxConnections = opts.maxConnections;

  const timer = setInterval(() => {
    const now = Date.now();
    for (const c of live) {
      const idle = now - c.lastActivity;
      if (idle > idleTimeout) {
        c.send({ command: "ERROR", params: ["Closing Link: Ping timeout"] });
        hub.detach(c, "Ping timeout");
        c.close();
      } else if (idle > pingInterval && !c.pinged) {
        c.pinged = true;
        c.send({ command: "PING", params: [hub.serverName] });
      }
    }
  }, 15_000);
  timer.unref();
  server.on("close", () => clearInterval(timer));

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolve(server));
  });
}
