// Usage: npm run smoke -- [host] [ircPort] [httpPort]
// Connects to a running server over raw TCP and WebSocket and exercises the Ghost.
import { runScenario } from "./smoke-lib.js";

const [host = "127.0.0.1", ircPort = "6667", httpPort = "8080"] = process.argv.slice(2);
try {
  const notes = await runScenario(host, Number(ircPort), Number(httpPort), "#seance", process.env.VERBOSE === "1");
  for (const n of notes) console.log("OK  " + n);
  console.log("SMOKE TEST PASSED");
  process.exit(0);
} catch (err) {
  console.error("SMOKE TEST FAILED:", (err as Error).message);
  process.exit(1);
}
