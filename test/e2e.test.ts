import { test } from "node:test";
import assert from "node:assert/strict";
import { startApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { runScenario } from "../scripts/smoke-lib.js";

test("end to end: real TCP + WebSocket clients and the mock Ghost", async () => {
  const cfg = loadConfig({
    IRC_HOST: "127.0.0.1", IRC_PORT: "0", HTTP_HOST: "127.0.0.1", HTTP_PORT: "0",
    DB_PATH: ":memory:", AI_PROVIDER: "mock", GHOST_COOLDOWN_MS: "0",
  });
  const app = await startApp(cfg);
  try {
    const notes = await runScenario("127.0.0.1", app.ircPort, app.httpPort);
    assert.ok(notes.length >= 10);
    const res = await fetch(`http://127.0.0.1:${app.httpPort}/api/info`);
    const info = (await res.json()) as { provider: string; ghost: string };
    assert.equal(info.provider, "mock");
    assert.equal(info.ghost, "Ghost");
    const page = await fetch(`http://127.0.0.1:${app.httpPort}/`);
    assert.match(await page.text(), /Seance Relay Chat/);
    const traversal = await fetch(`http://127.0.0.1:${app.httpPort}/..%2fpackage.json`);
    assert.notEqual(traversal.status, 200);
  } finally {
    await app.stop();
  }
});

test("config picks the mock provider when no key is set", () => {
  assert.equal(loadConfig({}).ai.provider, "mock");
  assert.equal(loadConfig({ AI_API_KEY: "x" }).ai.provider, "openai");
  assert.equal(loadConfig({ AI_API_KEY: "x", AI_PROVIDER: "mock" }).ai.provider, "mock");
  // Empty values (e.g. "AI_BASE_URL=" in an env file) fall back to defaults.
  const blank = loadConfig({ AI_BASE_URL: "", AI_MODEL: "", GHOST_NICK: "", IRC_PORT: "" });
  assert.equal(blank.ai.baseUrl, "https://api.openai.com/v1");
  assert.equal(blank.ai.model, "gpt-4o-mini");
  assert.equal(blank.ghost.nick, "Ghost");
  assert.equal(blank.ircPort, 6667);
});
