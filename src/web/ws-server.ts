import type http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { cloakHost, newId } from "../core/cloak.js";
import type { ChatHub } from "../core/hub.js";
import type { Client } from "../core/types.js";
import type { IrcMessage } from "../irc/message.js";
import { IrcToWs, parseWsCommand, wsCommandToIrc, type WsEvent } from "./bridge.js";

export interface WsOptions {
  path: string;
  cloakSalt: string;
  historyOnJoin: number;
  /** Optional allow-list of Origin headers. Empty = allow all. */
  allowedOrigins: string[];
}

class WsClient implements Client {
  readonly id = newId();
  readonly kind = "ws" as const;
  nick: string | null = null;
  username: string | null = null;
  realname: string | null = null;
  registered = false;
  channels = new Set<string>();
  lastActivity = Date.now();
  private readonly translator = new IrcToWs();

  constructor(private readonly ws: WebSocket, readonly host: string, private readonly onJoined: (ch: string) => void) {}

  send(msg: IrcMessage): void {
    const ev = this.translator.translate(msg);
    if (!ev) return;
    this.emit(ev);
    if (ev.type === "join" && this.nick && ev.nick === this.nick) this.onJoined(ev.channel);
  }

  emit(ev: WsEvent): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(ev));
  }

  close(): void {
    try { this.ws.close(1000, "bye"); } catch { /* already closed */ }
  }
}

export function attachWebSocket(server: http.Server, hub: ChatHub, opts: WsOptions): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== opts.path) {
      socket.destroy();
      return;
    }
    const origin = req.headers.origin ?? "";
    if (opts.allowedOrigins.length > 0 && !opts.allowedOrigins.includes(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
    const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
    const ip = fwd || req.socket.remoteAddress;
    const client: WsClient = new WsClient(ws, cloakHost("web", ip, opts.cloakSalt), (channel) => {
      // Replay recent history to the browser after it joins a channel.
      if (opts.historyOnJoin > 0) {
        client.emit({ type: "history", channel, entries: hub.recentHistory(channel, opts.historyOnJoin) });
      }
    });
    hub.attach(client);

    let alive = true;
    ws.on("pong", () => { alive = true; });
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 30_000);
    heartbeat.unref();

    ws.on("message", (data) => {
      let cmds: IrcMessage[];
      try {
        cmds = wsCommandToIrc(parseWsCommand(data.toString()));
      } catch (err) {
        client.emit({ type: "error", code: "BRIDGE", text: (err as Error).message });
        return;
      }
      for (const m of cmds) {
        try { hub.handle(client, m); } catch (err) { console.error("[ws] handler error", err); }
      }
    });
    ws.on("close", () => {
      clearInterval(heartbeat);
      hub.detach(client, "Web client closed");
    });
    ws.on("error", () => ws.terminate());
  });

  return wss;
}
