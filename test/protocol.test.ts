import { test } from "node:test";
import assert from "node:assert/strict";
import { LineBuffer, ircLower, isValidChannel, isValidNick, parseMessage, serializeMessage } from "../src/irc/message.js";

test("parses command with middle and trailing params", () => {
  assert.deepEqual(parseMessage("PRIVMSG #seance :hello there spirits"), {
    command: "PRIVMSG", params: ["#seance", "hello there spirits"],
  });
});

test("parses prefix and numeric", () => {
  assert.deepEqual(parseMessage(":srv.example 001 alice :Welcome to the network"), {
    prefix: "srv.example", command: "001", params: ["alice", "Welcome to the network"],
  });
});

test("parses USER with 4 params and lowercases command", () => {
  const m = parseMessage("user guest 0 * :Real Name\r\n");
  assert.equal(m?.command, "USER");
  assert.deepEqual(m?.params, ["guest", "0", "*", "Real Name"]);
});

test("keeps colons inside trailing and allows empty trailing", () => {
  assert.deepEqual(parseMessage("PRIVMSG #a :see: this :) works")?.params, ["#a", "see: this :) works"]);
  assert.deepEqual(parseMessage("TOPIC #a :")?.params, ["#a", ""]);
});

test("ignores IRCv3 tags and collapses repeated spaces", () => {
  assert.deepEqual(parseMessage("@time=2026-10-31T00:00:00Z :n!u@h  JOIN   #x"), {
    prefix: "n!u@h", command: "JOIN", params: ["#x"],
  });
});

test("rejects empty and malformed lines", () => {
  assert.equal(parseMessage(""), null);
  assert.equal(parseMessage(":onlyprefix"), null);
  assert.equal(parseMessage("BAD-CMD x"), null);
});

test("serializes with trailing colon only when needed", () => {
  assert.equal(serializeMessage({ command: "JOIN", params: ["#x"] }), "JOIN #x");
  assert.equal(serializeMessage({ prefix: "a!b@c", command: "PRIVMSG", params: ["#x", "hi there"] }), ":a!b@c PRIVMSG #x :hi there");
  assert.equal(serializeMessage({ command: "TOPIC", params: ["#x", ""] }), "TOPIC #x :");
  assert.equal(serializeMessage({ command: "PRIVMSG", params: ["#x", ":)"] }), "PRIVMSG #x ::)");
});

test("serialization strips CR/LF injection and caps at 510 bytes", () => {
  const s = serializeMessage({ command: "PRIVMSG", params: ["#x", "a\r\nQUIT :pwned"] });
  assert.ok(!s.includes("\n") && !s.includes("\r"));
  const long = serializeMessage({ command: "PRIVMSG", params: ["#x", "é".repeat(400)] });
  assert.ok(Buffer.byteLength(long) <= 510);
  assert.ok(!long.includes("\uFFFD"));
});

test("round-trips parse(serialize(x))", () => {
  const msg = { prefix: "Ghost!~ghost@beyond.the.veil", command: "PRIVMSG", params: ["#seance", "alice: boo!"] };
  assert.deepEqual(parseMessage(serializeMessage(msg)), msg);
});

test("LineBuffer splits CRLF and bare LF across chunks", () => {
  const lb = new LineBuffer();
  assert.deepEqual(lb.push("NICK al"), []);
  assert.deepEqual(lb.push("ice\r\nUSER a 0 * :A\nPI"), ["NICK alice", "USER a 0 * :A"]);
  assert.deepEqual(lb.push("NG x\r\n"), ["PING x"]);
});

test("rfc1459 casemapping and name validation", () => {
  assert.equal(ircLower("Ghost[]\\~"), "ghost{}|^");
  assert.ok(isValidNick("alice_"));
  assert.ok(isValidNick("[Wraith]"));
  assert.ok(!isValidNick("9lives"));
  assert.ok(!isValidNick("has space"));
  assert.ok(isValidChannel("#seance"));
  assert.ok(!isValidChannel("seance"));
  assert.ok(!isValidChannel("#a,b"));
});
