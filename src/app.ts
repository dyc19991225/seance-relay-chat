import type http from "node:http";
import type net from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { WebSocketServer } from "ws";
import type { Config } from "./config.js";
import { ChatHub } from "./core/hub.js";
import { GhostBot } from "./ghost/ghost.js";
import { type AiProvider, MockProvider, OpenAiCompatibleProvider } from "./ghost/providers.js";
import { startTcpServer } from "./irc/tcp-server.js";
import { SqliteHistory } from "./store/history.js";
import { createHttpServer } from "./web/http-server.js";
import { attachWebSocket } from "./web/ws-server.js";

export interface RunningApp {
  hub: ChatHub;
  ghost: GhostBot | null;
  history: SqliteHistory;
  irc: net.Server;
  http: http.Server;
  wss: WebSocketServer;
  ircPort: number;
  httpPort: number;
  stop(): Promise<void>;
}

export function makeProvider(cfg: Config): AiProvider {
  if (cfg.ai.provider === "openai") {
    return new OpenAiCompatibleProvider({
      baseUrl: cfg.ai.baseUrl, apiKey: cfg.ai.apiKey, model: cfg.ai.model,
      timeoutMs: cfg.ai.timeoutMs, maxTokens: cfg.ai.maxTokens,
    });
  }
  return new MockProvider();
}

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_WEB_ROOT = join(here, "..", "web");

export async function startApp(cfg: Config, opts: { webRoot?: string; provider?: AiProvider } = {}): Promise<RunningApp> {
  const history = new SqliteHistory(cfg.dbPath);
  if (cfg.historyRetentionDays > 0) history.prune(cfg.historyRetentionDays * 86_400_000);
  const hub = new ChatHub({
    serverName: cfg.serverName,
    networkName: cfg.networkName,
    motd: cfg.motd,
    defaultChannels: cfg.defaultChannels,
    history,
  });

  const provider = opts.provider ?? makeProvider(cfg);
  let ghost: GhostBot | null = null;
  if (cfg.ghost.enabled) {
    ghost = new GhostBot(hub, { ...cfg.ghost, channels: cfg.defaultChannels, provider });
    ghost.start();
  }

  const irc = await startTcpServer(hub, { host: cfg.ircHost, port: cfg.ircPort, cloakSalt: cfg.cloakSalt, maxConnections: 500 });
  const httpServer = createHttpServer(hub, opts.webRoot ?? DEFAULT_WEB_ROOT, {
    ircPort: cfg.ircPort, publicIrcHost: cfg.publicIrcHost, ghostNick: ghost?.nick ?? null, provider: provider.name,
  });
  const wss = attachWebSocket(httpServer, hub, {
    path: "/ws", cloakSalt: cfg.cloakSalt, historyOnJoin: cfg.historyOnJoin, allowedOrigins: cfg.allowedOrigins,
  });
  await new Promise<void>((r, j) => {
    httpServer.once("error", j);
    httpServer.listen(cfg.httpPort, cfg.httpHost, () => r());
  });

  const portOf = (s: net.Server | http.Server) => {
    const a = s.address();
    return typeof a === "object" && a ? a.port : 0;
  };

  return {
    hub, ghost, history, irc, http: httpServer, wss,
    ircPort: portOf(irc), httpPort: portOf(httpServer),
    async stop() {
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise<void>((r) => irc.close(() => r()));
      httpServer.closeAllConnections?.();
      await new Promise<void>((r) => httpServer.close(() => r()));
      await ghost?.idle();
      history.close();
    },
  };
}
