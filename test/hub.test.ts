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
  // strip any op prefix (@) before comparing — alice is op, bob is not
  const nicks = (names.params[3] ?? "").split(" ").map((n) => n.replace(/^@/, ""));
  assert.deepEqual(nicks.sort(), ["alice", "bob"]);
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

// ---- Channel operators and KICK (task 5.2) ----

test("first joiner of a channel becomes op (@ in NAMES)", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  const b = connect(hub, "bob");
  // alice creates #ops-test
  line(hub, a, "JOIN #ops-test");
  a.take();
  // bob joins after alice
  line(hub, b, "JOIN #ops-test");
  b.take();
  // query NAMES; alice should be @alice, bob just bob
  line(hub, a, "NAMES #ops-test");
  const names = a.take().find((m) => m.command === "353");
  assert.ok(names, "353 NAMREPLY received");
  const list = (names.params[3] ?? "").split(" ");
  assert.ok(list.includes("@alice"), "alice is an op");
  assert.ok(list.includes("bob"), "bob is not an op");
});

test("op can grant op with MODE +o; receiver gets @ in NAMES", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  const b = connect(hub, "bob");
  line(hub, a, "JOIN #ops-test");
  line(hub, b, "JOIN #ops-test");
  a.take(); b.take();

  line(hub, a, "MODE #ops-test +o bob");
  // both members should see the MODE message
  const aMode = a.take().find((m) => m.command === "MODE");
  const bMode = b.take().find((m) => m.command === "MODE");
  assert.ok(aMode, "alice sees MODE");
  assert.deepEqual(aMode?.params, ["#ops-test", "+o", "bob"]);
  assert.ok(bMode, "bob sees MODE");

  // bob should now be @bob in NAMES
  line(hub, a, "NAMES #ops-test");
  const names = a.take().find((m) => m.command === "353");
  const list = (names?.params[3] ?? "").split(" ");
  assert.ok(list.includes("@bob"), "bob is now an op");
});

test("op can revoke op with MODE -o", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  const b = connect(hub, "bob");
  line(hub, a, "JOIN #ops-test");
  line(hub, b, "JOIN #ops-test");
  a.take(); b.take();
  // grant then revoke
  line(hub, a, "MODE #ops-test +o bob");
  a.take(); b.take();
  line(hub, a, "MODE #ops-test -o bob");
  a.take(); b.take();

  line(hub, a, "NAMES #ops-test");
  const names = a.take().find((m) => m.command === "353");
  const list = (names?.params[3] ?? "").split(" ");
  assert.ok(!list.includes("@bob"), "bob is no longer an op");
  assert.ok(list.includes("bob"), "bob is still in the channel");
});

test("non-op gets 482 when trying MODE +o", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  const b = connect(hub, "bob");
  line(hub, a, "JOIN #ops-test");
  line(hub, b, "JOIN #ops-test");
  a.take(); b.take();
  // bob tries to op alice; bob is not an op
  line(hub, b, "MODE #ops-test +o alice");
  assert.equal(b.take()[0]?.command, "482", "non-op gets 482");
});

test("op can KICK a user; KICK is broadcast before removal", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  const b = connect(hub, "bob");
  line(hub, a, "JOIN #seance2");
  line(hub, b, "JOIN #seance2");
  a.take(); b.take();

  line(hub, a, "KICK #seance2 bob :behave yourself");
  // both alice and bob should see the KICK
  const aKick = a.take().find((m) => m.command === "KICK");
  const bKick = b.take().find((m) => m.command === "KICK");
  assert.ok(aKick, "alice sees KICK");
  assert.deepEqual(aKick?.params, ["#seance2", "bob", "behave yourself"]);
  assert.ok(bKick, "bob sees KICK (before being removed)");
  // bob is no longer in the channel
  assert.ok(!hub.getChannel("#seance2")?.members.has(b), "bob was removed");
  assert.ok(!b.channels.has("seance2"), "bob's channel set updated");
});

test("KICK with no reason uses kicker's nick as reason", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  const b = connect(hub, "bob");
  line(hub, a, "JOIN #seance2");
  line(hub, b, "JOIN #seance2");
  a.take(); b.take();
  line(hub, a, "KICK #seance2 bob");
  const kick = a.take().find((m) => m.command === "KICK");
  assert.equal(kick?.params[2], "alice", "default reason is kicker nick");
});

test("KICK by non-op gets 482", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  const b = connect(hub, "bob");
  const c = connect(hub, "carol");
  line(hub, a, "JOIN #seance2");
  line(hub, b, "JOIN #seance2");
  line(hub, c, "JOIN #seance2");
  a.take(); b.take(); c.take();
  // bob is not an op; bob tries to kick carol
  line(hub, b, "KICK #seance2 carol :out");
  assert.equal(b.take()[0]?.command, "482", "non-op kick gives 482");
  assert.ok(hub.getChannel("#seance2")?.members.has(c), "carol still in channel");
});

test("KICK on non-existent channel gives 403", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  a.take();
  line(hub, a, "KICK #ghost bob :bye");
  assert.equal(a.take()[0]?.command, "403");
});

test("KICK target not in channel gives 441", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  const b = connect(hub, "bob");
  line(hub, a, "JOIN #seance2");
  a.take(); b.take();
  // bob hasn't joined #seance2
  line(hub, a, "KICK #seance2 bob :bye");
  assert.equal(a.take()[0]?.command, "441");
});

test("KICK when kicker not in channel gives 442", () => {
  const { hub } = makeHub();
  const a = connect(hub, "alice");
  const b = connect(hub, "bob");
  line(hub, b, "JOIN #seance2");
  a.take(); b.take();
  // alice is not in #seance2
  line(hub, a, "KICK #seance2 bob :bye");
  assert.equal(a.take()[0]?.command, "442");
});
