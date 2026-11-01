import { startApp } from "./app.js";
import { loadConfig } from "./config.js";

const cfg = loadConfig();
const app = await startApp(cfg);

console.log(`[seance] IRC server listening on ${cfg.ircHost}:${app.ircPort} (plain TCP)`);
console.log(`[seance] Web client on http://${cfg.httpHost}:${app.httpPort}  (WebSocket at /ws)`);
console.log(`[seance] Ghost: ${app.ghost ? app.ghost.nick : "disabled"}  AI provider: ${cfg.ai.provider}` +
  (cfg.ai.provider === "openai" ? ` (${cfg.ai.model} @ ${new URL(cfg.ai.baseUrl).host})` : " (offline mock, no key needed)"));

let stopping = false;
async function shutdown(sig: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[seance] ${sig} received, laying the server to rest...`);
  const t = setTimeout(() => process.exit(1), 5000);
  t.unref();
  await app.stop();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
