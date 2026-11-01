import { readFile } from "node:fs/promises";
import http from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import type { ChatHub } from "../core/hub.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

export interface HttpInfo {
  ircPort: number;
  publicIrcHost: string;
  ghostNick: string | null;
  provider: string;
}

export function createHttpServer(hub: ChatHub, webRoot: string, info: HttpInfo): http.Server {
  const root = resolve(webRoot);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const security = {
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy":
        "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    };
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json", ...security });
      res.end(JSON.stringify({ ok: true, clients: hub.clientCount() }));
      return;
    }
    if (url.pathname === "/api/info") {
      res.writeHead(200, { "content-type": "application/json", ...security });
      res.end(JSON.stringify({
        network: hub.networkName,
        server: hub.serverName,
        ircPort: info.ircPort,
        ircHost: info.publicIrcHost || null,
        ghost: info.ghostNick,
        provider: info.provider,
        channels: hub.listChannels().map((c) => ({ name: c.name, users: c.members.size, topic: c.topic })),
      }));
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, security);
      res.end();
      return;
    }
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = normalize(join(root, decodeURIComponent(rel)));
    if (!file.startsWith(root)) {
      res.writeHead(403, security);
      res.end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", ...security });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain", ...security });
      res.end("Not found (this page stayed in the grave)");
    }
  });
}
