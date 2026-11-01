import { test } from "node:test";
import assert from "node:assert/strict";
import { connect, line, makeHub } from "./helpers.js";

test("registration sends 001-005 and MOTD", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  const cmds = a.commands();
  for (const code of ["001", "002", "003", "004", "005", "375", "372", "376"]) assert.ok(cmds.includes(code), code);
  assert.equal(a.registered, true);
});

test("commands before registration get 451; PING works before registration", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  a.take();
  const { hub: hub2 } = makeHub();
  const b = new (a.constructor as any)();
  hub2.attach(b);
  line(hub2, b, "JOIN #seance");
  assert.equal(b.inbox[0].command, "451");
  line(hub2, b, "PING :abc");
  assert.deepEqual(b.inbox[1].params, ["test.server", "abc"]);
});

test("nickname collisions are case-insensitive (433)", () => {
  const { hub } = makeHub();
  connect(hub, "Alice");
  const b = connect(hub, "aLICE");
  assert.equal(b.inbox[0]?.command, "433");
  assert.equal(b.registered, false);
});

test("JOIN broadcasts, sends NAMES, and PRIVMSG reaches other members only", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  const b = connect(hub, "bob");
  line(hub, a, "JOIN #seance");
  a.take();
  line(hub, b, "JOIN #seance");
  const aSaw = a.take();
  assert.equal(aSaw[0]?.command, "JOIN");
  assert.equal(aSaw[0]?.prefix?.startsWith("bob!"), true);
  const bSaw = b.take();
  const names = bSaw.find((m) => m.command === "353");
  assert.ok(names);
  assert.deepEqual(names.params[3]?.split(" ").sort(), ["alice", "bob"]);
  assert.ok(bSaw.some((m) => m.command === "366"));

  line(hub, a, "PRIVMSG #seance :boo");
  assert.equal(a.inbox.length, 0, "sender does not get an echo");
  assert.deepEqual(b.take()[0], { prefix: "alice!~alice@test.spirit", command: "PRIVMSG", params: ["#seance", "boo"] });
});

test("cannot send to a channel you have not joined (404); unknown target 401", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  a.take();
  line(hub, a, "PRIVMSG #seance :hi");
  assert.equal(a.take()[0]?.command, "404");
  line(hub, a, "PRIVMSG nobody :hi");
  assert.equal(a.take()[0]?.command, "401");
  line(hub, a, "NOTICE nobody :hi");
  assert.equal(a.inbox.length, 0, "NOTICE never triggers error replies");
});

test("private PRIVMSG goes to the nick", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  const b = connect(hub, "bob");
  b.take();
  line(hub, a, "PRIVMSG Bob :psst");
  assert.deepEqual(b.take()[0]?.params, ["Bob", "psst"]);
});

test("TOPIC set, query, and 331 when unset", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  line(hub, a, "JOIN #seance");
  a.take();
  line(hub, a, "TOPIC #seance");
  assert.equal(a.take()[0]?.command, "331");
  line(hub, a, "TOPIC #seance :Night of the living protocol");
  assert.deepEqual(a.take()[0]?.params, ["#seance", "Night of the living protocol"]);
  line(hub, a, "TOPIC #seance");
  const r = a.take();
  assert.equal(r[0]?.command, "332");
  assert.equal(r[1]?.command, "333");
});

test("PART and QUIT notify members and free the nick", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  const b = connect(hub, "bob");
  line(hub, a, "JOIN #seance,#crypt");
  line(hub, b, "JOIN #seance");
  a.take(); b.take();
  line(hub, a, "PART #crypt :bye");
  assert.equal(hub.getChannel("#crypt"), undefined, "empty non-default channel is dropped");
  line(hub, a, "PART #crypt");
  assert.equal(a.take().at(-1)?.command, "403");
  line(hub, a, "QUIT :gone haunting");
  assert.equal(a.closed, true);
  assert.equal(a.take()[0]?.command, "ERROR");
  const q = b.take()[0];
  assert.equal(q?.command, "QUIT");
  assert.equal(q?.params[0], "Quit: gone haunting");
  assert.equal(hub.getClientByNick("alice"), undefined);
  assert.equal(hub.getChannel("#seance")?.members.size, 1);
});

test("NICK change is broadcast to channel peers", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  const b = connect(hub, "bob");
  line(hub, a, "JOIN #seance");
  line(hub, b, "JOIN #seance");
  a.take(); b.take();
  line(hub, a, "NICK banshee");
  assert.deepEqual(b.take()[0], { prefix: "alice!~alice@test.spirit", command: "NICK", params: ["banshee"] });
  assert.equal(hub.getClientByNick("banshee"), a);
});

test("missing params give 461 / 411 / 412, unknown command 421", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  a.take();
  line(hub, a, "JOIN");
  line(hub, a, "PRIVMSG");
  line(hub, a, "PRIVMSG #seance");
  line(hub, a, "FROBNICATE");
  assert.deepEqual(a.commands(), ["461", "411", "412", "421"]);
});

test("channel messages are written to SQLite history", () => {
  const { hub, history } = makeHub();
  const a = connect(hub, "alice");
  line(hub, a, "JOIN #Seance");
  line(hub, a, "PRIVMSG #seance :first");
  line(hub, a, "PRIVMSG #SEANCE :\x01ACTION floats\x01");
  const h = history!.recent("#seance", 10);
  assert.deepEqual(h.map((e) => [e.kind, e.text]), [["join", ""], ["msg", "first"], ["action", "floats"]]);
});

test("flood protection throttles bursts", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  line(hub, a, "JOIN #seance");
  a.take();
  for (let i = 0; i < 25; i++) line(hub, a, `PRIVMSG #seance :spam ${i}`);
  assert.ok(a.inbox.some((m) => m.command === "NOTICE" && /Flood/.test(m.params[1] ?? "")));
});
