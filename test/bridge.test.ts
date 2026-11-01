import { test } from "node:test";
import assert from "node:assert/strict";
import { IrcToWs, parseWsCommand, wsCommandToIrc } from "../src/web/bridge.js";
import { connect, line, makeHub, FakeClient } from "./helpers.js";

test("hello becomes NICK + USER", () => {
  const msgs = wsCommandToIrc({ type: "hello", nick: "wraith" });
  assert.deepEqual(msgs.map((m) => m.command), ["NICK", "USER"]);
  assert.equal(msgs[0]?.params[0], "wraith");
  assert.equal(msgs[1]?.params.length, 4);
});

test("msg/action/topic/raw translate to IRC", () => {
  assert.deepEqual(wsCommandToIrc({ type: "msg", target: "#seance", text: "hi\r\nQUIT" })[0], {
    command: "PRIVMSG", params: ["#seance", "hi  QUIT"],
  });
  assert.equal(wsCommandToIrc({ type: "action", target: "#a", text: "waves" })[0]?.params[1], "\x01ACTION waves\x01");
  assert.deepEqual(wsCommandToIrc({ type: "topic", channel: "#a" })[0]?.params, ["#a"]);
  assert.deepEqual(wsCommandToIrc({ type: "raw", line: "LIST" })[0], { command: "LIST", params: [] });
  assert.throws(() => wsCommandToIrc({ type: "raw", line: ":::" }));
  assert.throws(() => wsCommandToIrc({ type: "nope" } as never));
});

test("parseWsCommand rejects junk", () => {
  assert.throws(() => parseWsCommand("not json"));
  assert.throws(() => parseWsCommand("{}"));
  assert.throws(() => parseWsCommand(JSON.stringify({ type: "msg", text: "x".repeat(5000) })));
  assert.equal(parseWsCommand('{"type":"list"}').type, "list");
});

test("IrcToWs maps messages, actions and accumulates NAMES", () => {
  const t = new IrcToWs();
  const ev = t.translate({ prefix: "bob!~b@h", command: "PRIVMSG", params: ["#a", "\x01ACTION howls\x01"] }, 1);
  assert.deepEqual(ev, { type: "message", from: "bob", target: "#a", text: "howls", notice: false, action: true, ts: 1 });
  assert.equal(t.translate({ prefix: "s", command: "353", params: ["me", "=", "#a", "alice bob"] }), null);
  assert.equal(t.translate({ prefix: "s", command: "353", params: ["me", "=", "#a", "Ghost"] }), null);
  assert.deepEqual(t.translate({ prefix: "s", command: "366", params: ["me", "#a", "End"] }), {
    type: "names", channel: "#a", nicks: ["alice", "bob", "Ghost"],
  });
  assert.deepEqual(t.translate({ prefix: "s", command: "433", params: ["*", "bob", "Nickname is already in use"] }), {
    type: "error", code: "433", text: "bob Nickname is already in use",
  });
});

test("a bridged web user and a TCP user share the same channel", () => {
  const { hub } = makeHub();
  const tcp = connect(hub, "irssiUser");
  line(hub, tcp, "JOIN #seance");
  tcp.take();

  // Simulate the WebSocket session: commands in via the bridge, events out via IrcToWs.
  const web = new FakeClient();
  hub.attach(web);
  for (const m of wsCommandToIrc({ type: "hello", nick: "webby" })) hub.handle(web, m);
  for (const m of wsCommandToIrc({ type: "join", channel: "#seance" })) hub.handle(web, m);
  for (const m of wsCommandToIrc({ type: "msg", target: "#seance", text: "hello from the browser" })) hub.handle(web, m);

  const seen = tcp.take();
  assert.ok(seen.some((m) => m.command === "JOIN" && m.prefix?.startsWith("webby!")));
  const pm = seen.find((m) => m.command === "PRIVMSG");
  assert.deepEqual(pm?.params, ["#seance", "hello from the browser"]);

  web.take();
  line(hub, tcp, "PRIVMSG #seance :hello from irssi");
  const t = new IrcToWs();
  const events = web.take().map((m) => t.translate(m, 0)).filter(Boolean);
  assert.deepEqual(events[0], { type: "message", from: "irssiUser", target: "#seance", text: "hello from irssi", notice: false, action: false, ts: 0 });
});
