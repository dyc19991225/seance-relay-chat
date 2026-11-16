import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { IrcToWs } from "../src/web/bridge.js";

// Exercise the shipped browser handler against its small DOM surface.
class Element {
  children: Element[] = [];
  className = "";
  style: Record<string, string> = {};
  textContent = "";
  value = "";
  hidden = false;
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  classList = { add: (name: string) => { this.className += " " + name; } };
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.children = children; }
  addEventListener() {}
  focus() {}
}

function browser() {
  const elements = new Map<string, Element>();
  const context = vm.createContext({
    document: {
      getElementById(id: string) {
        if (!elements.has(id)) elements.set(id, new Element());
        return elements.get(id);
      },
      createElement: () => new Element(),
    },
    localStorage: { getItem: () => null, setItem() {} },
    location: { hostname: "test.local" },
    fetch: async () => ({ json: async () => ({ channels: [], ircPort: 0, provider: "mock" }) }),
    console,
  });
  vm.runInContext(readFileSync(new URL("../web/app.js", import.meta.url), "utf8"), context);
  const run = (source: string) => vm.runInContext(source, context);
  run(`handle({type:"welcome",nick:"member",text:"hello"});
       handle({type:"join",nick:"member",channel:"#audit",ts:1});
       handle({type:"names",channel:"#audit",nicks:["@operator","member"]});`);
  return {
    run,
    kick(nick: string, channel = "#audit") {
      const event = new IrcToWs().translate({
        prefix: "operator!u@h", command: "KICK", params: [channel, nick, "reason"],
      });
      run(`handle(${JSON.stringify(event)})`);
    },
  };
}

test("browser removes a kicked channel and switches away from its composer", () => {
  const b = browser();
  b.kick("MEMBER");
  assert.equal(b.run('state.buffers.has(lower("#audit"))'), false);
  assert.equal(b.run('state.active.name === "#audit"'), false);
  assert.ok(b.run('state.buffers.get(SERVER).lines.length > 0'));
});

test("browser removes a kicked operator from the prefixed NAMES list", () => {
  const b = browser();
  b.kick("operator");
  assert.equal(b.run('state.buffers.get(lower("#audit")).nicks.has("@operator")'), false);
  assert.equal(b.run('state.active.name'), "#audit");
  assert.equal(b.run('state.buffers.get(lower("#audit")).nicks.has("member")'), true);
});

test("a background channel kick preserves the active channel", () => {
  const b = browser();
  b.run('handle({type:"join",nick:"member",channel:"#other",ts:2})');
  b.kick("member");
  assert.equal(b.run('state.buffers.has(lower("#audit"))'), false);
  assert.equal(b.run('state.active.name'), "#other");
});
