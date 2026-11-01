import { test } from "node:test";
import assert from "node:assert/strict";
import { GhostBot, formatTranscript, parseGhostCommand, toIrcLines } from "../src/ghost/ghost.js";
import { type AiProvider, MockProvider, OpenAiCompatibleProvider, parseTranscript } from "../src/ghost/providers.js";
import { connect, line, makeHub } from "./helpers.js";

const baseOpts = {
  nick: "Ghost", channels: ["#seance"], cooldownMs: 0, maxReplyLines: 5,
  summaryDefault: 50, summaryMax: 200, maxConcurrent: 3,
};

function setup(provider: AiProvider = new MockProvider(), extra: Partial<typeof baseOpts> = {}) {
  const { hub, history } = makeHub();
  const ghost = new GhostBot(hub, { ...baseOpts, ...extra, provider });
  ghost.start();
  const a = connect(hub, "alice");
  const b = connect(hub, "bob");
  line(hub, a, "JOIN #seance");
  line(hub, b, "JOIN #seance");
  a.take(); b.take();
  return { hub, history, ghost, a, b };
}

const ghostLines = (msgs: { prefix?: string; command: string; params: string[] }[]) =>
  msgs.filter((m) => m.command === "PRIVMSG" && m.prefix?.startsWith("Ghost!")).map((m) => m.params[1]);

test("parseGhostCommand recognizes commands and mentions", () => {
  assert.deepEqual(parseGhostCommand("!ask what is IRC?", "Ghost"), { kind: "ask", question: "what is IRC?" });
  assert.deepEqual(parseGhostCommand("!summary 20", "Ghost"), { kind: "summary", count: 20 });
  assert.deepEqual(parseGhostCommand("!summary", "Ghost"), { kind: "summary", count: null });
  assert.deepEqual(parseGhostCommand("!TLDR", "Ghost"), { kind: "tldr" });
  assert.deepEqual(parseGhostCommand("!help", "Ghost"), { kind: "help" });
  assert.deepEqual(parseGhostCommand("ghost: are you there?", "Ghost"), { kind: "mention", question: "are you there?" });
  assert.deepEqual(parseGhostCommand("hey @Ghost boo", "Ghost"), { kind: "mention", question: "hey @Ghost boo" });
  assert.equal(parseGhostCommand("ghost stories are the best", "Ghost"), null);
  assert.equal(parseGhostCommand("!asking around", "Ghost"), null);
  assert.equal(parseGhostCommand("just chatting", "Ghost"), null);
});

test("ghost joins default channels as a normal user", () => {
  const { hub } = setup();
  const ch = hub.getChannel("#seance")!;
  assert.ok([...ch.members].some((m) => m.nick === "Ghost"));
});

test("!ask gets a mock reply addressed to the asker", async () => {
  const { ghost, a, b } = setup();
  line(ghost["hub"], a, "PRIVMSG #seance :!ask who invented IRC?");
  await ghost.idle();
  const replies = ghostLines(b.take());
  assert.equal(replies.length, 1);
  assert.match(replies[0]!, /^alice: \[mock\] The spirits heard: "who invented IRC\?"/);
  assert.equal(ghostLines(a.take()).length, 1, "asker sees the reply too");
});

test("!summary summarizes recent channel history via the provider", async () => {
  const { hub, ghost, a, b } = setup();
  line(hub, a, "PRIVMSG #seance :let's deploy the pumpkin server tonight");
  line(hub, b, "PRIVMSG #seance :pumpkin server needs caddy first");
  line(hub, a, "PRIVMSG #seance :ok caddy then pumpkin");
  b.take();
  line(hub, b, "PRIVMSG #seance :!summary");
  await ghost.idle();
  const replies = ghostLines(a.take());
  assert.match(replies[0]!, /^bob: \[mock\] Summary of the last 3 messages from 2 souls \(alice, bob\)/);
  assert.match(replies.join("\n"), /Recurring words: pumpkin, caddy, server/);
});

test("!tldr gives a one-liner", async () => {
  const { hub, ghost, a } = setup();
  line(hub, a, "PRIVMSG #seance :graveyard shift begins");
  line(hub, a, "PRIVMSG #seance :!tldr");
  await ghost.idle();
  const replies = ghostLines(a.take());
  assert.equal(replies.length, 1);
  assert.match(replies[0]!, /TL;DR: 1 messages from 1 souls/);
});

test("mentions and private messages are answered; NOTICE and own lines are ignored", async () => {
  const { hub, ghost, a } = setup();
  line(hub, a, "PRIVMSG #seance :Ghost: what year is it?");
  line(hub, a, "NOTICE #seance :!ask ignored?");
  await ghost.idle();
  assert.equal(ghostLines(a.take()).length, 1);
  line(hub, a, "PRIVMSG Ghost :hello in private");
  await ghost.idle();
  const pm = a.take().find((m) => m.command === "PRIVMSG");
  assert.equal(pm?.params[0], "alice");
  assert.match(pm!.params[1]!, /hello in private/);
});

test("per-nick cooldown sends a NOTICE instead of a second call", async () => {
  let calls = 0;
  const counting: AiProvider = { name: "count", complete: async () => { calls++; return "ok"; } };
  const { hub, ghost, a } = setup(counting, { cooldownMs: 60_000 });
  line(hub, a, "PRIVMSG #seance :!ask one");
  await ghost.idle();
  line(hub, a, "PRIVMSG #seance :!ask two");
  await ghost.idle();
  assert.equal(calls, 1);
  assert.ok(a.take().some((m) => m.command === "NOTICE" && /moment/.test(m.params[1] ?? "")));
});

test("provider errors produce a friendly message, not a crash", async () => {
  const broken: AiProvider = { name: "broken", complete: async () => { throw new Error("boom"); } };
  const { hub, ghost, a } = setup(broken);
  const orig = console.error; console.error = () => {};
  try {
    line(hub, a, "PRIVMSG #seance :!ask hello?");
    await ghost.idle();
  } finally { console.error = orig; }
  assert.match(ghostLines(a.take())[0]!, /veil is too thick/);
});

test("long multi-line answers are split and capped", () => {
  const lines = toIrcLines("a\n\n" + "word ".repeat(300) + "\nb\nc\nd\ne\nf", 5);
  assert.equal(lines.length, 5);
  for (const l of lines) assert.ok(Buffer.byteLength(l) <= 400);
  assert.ok(lines[4]!.endsWith("..."));
});

test("transcript excludes the ghost and command lines", () => {
  const t = formatTranscript([
    { ts: 0, channel: "#a", nick: "alice", kind: "msg", text: "hi" },
    { ts: 0, channel: "#a", nick: "Ghost", kind: "msg", text: "boo" },
    { ts: 0, channel: "#a", nick: "bob", kind: "msg", text: "!summary" },
    { ts: 0, channel: "#a", nick: "bob", kind: "join", text: "" },
    { ts: 0, channel: "#a", nick: "carol", kind: "msg", text: "!ask is IRC dead?" },
  ], "Ghost");
  assert.deepEqual(parseTranscript(t), [{ nick: "alice", text: "hi" }, { nick: "carol", text: "is IRC dead?" }]);
});

test("OpenAI-compatible provider sends the right request and parses the reply", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ choices: [{ message: { content: " hello mortal " } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const p = new OpenAiCompatibleProvider({ baseUrl: "https://llm.example/v1/", apiKey: "test-key", model: "m1", timeoutMs: 1000, maxTokens: 50 }, fakeFetch);
  const out = await p.complete([{ role: "user", content: "hi" }], { task: "ask" });
  assert.equal(out, "hello mortal");
  assert.equal(seen!.url, "https://llm.example/v1/chat/completions");
  assert.equal((seen!.init.headers as Record<string, string>).authorization, "Bearer test-key");
  const body = JSON.parse(String(seen!.init.body));
  assert.equal(body.model, "m1");
  assert.equal(body.max_tokens, 50);

  const failing = new OpenAiCompatibleProvider({ baseUrl: "https://x/v1", apiKey: "k", model: "m", timeoutMs: 1000, maxTokens: 5 },
    (async () => new Response("secret details", { status: 401 })) as unknown as typeof fetch);
  await assert.rejects(failing.complete([], { task: "ask" }), /HTTP 401$/);
});
