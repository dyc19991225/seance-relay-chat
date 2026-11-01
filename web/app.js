// Seance Relay Chat browser client. Plain ES module, no build step, no third-party code.
const $ = (id) => document.getElementById(id);
const el = {
  status: $("status"), layout: $("layout"), login: $("login"), loginForm: $("loginForm"), nickInput: $("nickInput"),
  loginHint: $("loginHint"), bufferList: $("bufferList"), joinForm: $("joinForm"), joinInput: $("joinInput"),
  topic: $("topic"), log: $("log"), inputForm: $("inputForm"), input: $("input"), prompt: $("prompt"),
  nickList: $("nickList"), nickCount: $("nickCount"), ircHint: $("ircHint"),
};

const state = {
  ws: null, nick: null, info: null, active: null,
  /** name(lower) -> { name, lines: [], nicks: Set, topic, unread, isChannel } */
  buffers: new Map(),
  history: [], historyPos: -1, wanted: [], autoJoin: new Set(),
};
const SERVER = "*server*";
const lower = (s) => s.toLowerCase();

function buffer(name) {
  const key = lower(name);
  let b = state.buffers.get(key);
  if (!b) {
    b = { name, lines: [], nicks: new Set(), topic: "", unread: 0, isChannel: name.startsWith("#") };
    state.buffers.set(key, b);
    renderBuffers();
  }
  return b;
}

function nickColor(nick) {
  let h = 0;
  for (const c of nick) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 70% 68%)`;
}
const hhmm = (ts) => new Date(ts).toTimeString().slice(0, 5);

/** Append a line. Everything goes through textContent: no HTML injection possible. */
function addLine(bufName, { ts = Date.now(), nick = null, text = "", cls = "", isAction = false }) {
  const b = buffer(bufName);
  const li = document.createElement("li");
  if (cls) li.className = cls;
  const t = document.createElement("span");
  t.className = "ts"; t.textContent = hhmm(ts);
  li.append(t);
  if (nick) {
    const n = document.createElement("span");
    n.className = "nick"; n.style.color = nickColor(nick);
    n.textContent = isAction ? `* ${nick} ` : `<${nick}> `;
    li.append(n);
    if (state.info && state.info.ghost && lower(nick) === lower(state.info.ghost)) li.classList.add("from-bot");
    if (state.nick && nick !== state.nick && text.toLowerCase().includes(state.nick.toLowerCase())) li.classList.add("mention");
  }
  const body = document.createElement("span");
  body.className = "text"; body.textContent = text;
  li.append(body);
  b.lines.push(li);
  if (b.lines.length > 1000) b.lines.shift();
  if (state.active === b) {
    const stick = el.log.scrollTop + el.log.clientHeight >= el.log.scrollHeight - 30;
    el.log.append(li);
    while (el.log.children.length > 1000) el.log.firstChild.remove();
    if (stick) el.log.scrollTop = el.log.scrollHeight;
  } else if (!cls.includes("sys") && !cls.includes("history")) {
    b.unread++;
    renderBuffers();
  }
}
const sys = (buf, text, cls = "sys") => addLine(buf, { text, cls });

function setActive(name) {
  const b = buffer(name);
  state.active = b; b.unread = 0;
  el.log.replaceChildren(...b.lines);
  el.log.scrollTop = el.log.scrollHeight;
  el.topic.textContent = b.isChannel ? (b.topic || "(no topic: the spirits are quiet)") : (b.name === SERVER ? "server messages" : `private seance with ${b.name}`);
  el.prompt.textContent = `${b.name}>`;
  renderBuffers(); renderNicks();
  el.input.focus();
}

function renderBuffers() {
  const items = [...state.buffers.values()].map((b) => {
    const li = document.createElement("li");
    li.textContent = b.name;
    if (b === state.active) li.className = "active";
    if (b.unread) { const u = document.createElement("span"); u.className = "unread"; u.textContent = String(b.unread); li.append(u); }
    li.addEventListener("click", () => setActive(b.name));
    return li;
  });
  el.bufferList.replaceChildren(...items);
}

function renderNicks() {
  const b = state.active;
  const nicks = b && b.isChannel ? [...b.nicks].sort((x, y) => x.localeCompare(y, undefined, { sensitivity: "base" })) : [];
  el.nickCount.textContent = nicks.length ? `(${nicks.length})` : "";
  el.nickList.replaceChildren(...nicks.map((n) => {
    const li = document.createElement("li");
    li.textContent = n; li.style.color = nickColor(n);
    if (state.info && state.info.ghost && lower(n) === lower(state.info.ghost)) { li.className = "bot"; li.title = "AI assistant: try !help"; }
    li.addEventListener("dblclick", () => { buffer(n); setActive(n); });
    return li;
  }));
}

function send(obj) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(obj));
}

function handle(ev) {
  switch (ev.type) {
    case "welcome":
      state.nick = ev.nick;
      el.login.hidden = true; el.layout.hidden = false;
      sys(SERVER, ev.text);
      for (const ch of state.wanted) { state.autoJoin.add(lower(ch)); send({ type: "join", channel: ch }); }
      break;
    case "message": {
      const toMe = state.nick && lower(ev.target) === lower(state.nick);
      const buf = toMe ? ev.from : ev.target;
      if (ev.notice && (!ev.from || ev.from.includes("."))) { sys(state.active ? state.active.name : SERVER, `-${ev.from || "server"}- ${ev.text}`, "notice"); break; }
      addLine(buf, { ts: ev.ts, nick: ev.from, text: ev.notice ? `-notice- ${ev.text}` : ev.text, cls: ev.notice ? "notice" : (ev.action ? "action" : ""), isAction: ev.action });
      break;
    }
    case "join": {
      const b = buffer(ev.channel);
      b.nicks.add(ev.nick);
      if (ev.nick === state.nick) {
        b.lines = [];
        // Auto-joined channels only take focus if nothing is open yet; explicit /join always does.
        const auto = state.autoJoin.delete(lower(ev.channel));
        if (!auto || !state.active || !state.active.isChannel) setActive(ev.channel);
        else renderBuffers();
      }
      sys(ev.channel, `--> ${ev.nick} materialized in ${ev.channel}`);
      if (state.active === b) renderNicks();
      break;
    }
    case "part": {
      const b = buffer(ev.channel);
      b.nicks.delete(ev.nick);
      if (ev.nick === state.nick) {
        state.buffers.delete(lower(ev.channel));
        setActive(state.buffers.size ? [...state.buffers.values()].pop().name : SERVER);
      } else {
        sys(ev.channel, `<-- ${ev.nick} faded away${ev.reason ? ` (${ev.reason})` : ""}`);
        if (state.active === b) renderNicks();
      }
      break;
    }
    case "quit":
      for (const b of state.buffers.values()) if (b.nicks.delete(ev.nick)) sys(b.name, `<-- ${ev.nick} left this world (${ev.reason})`);
      renderNicks();
      break;
    case "nick":
      if (ev.from === state.nick) state.nick = ev.to;
      for (const b of state.buffers.values()) if (b.nicks.delete(ev.from)) { b.nicks.add(ev.to); sys(b.name, `${ev.from} is now known as ${ev.to}`); }
      renderNicks();
      break;
    case "topic": {
      const b = buffer(ev.channel);
      b.topic = ev.topic;
      if (ev.by) sys(ev.channel, `${ev.by} changed the topic to: ${ev.topic}`);
      if (state.active === b) el.topic.textContent = ev.topic || "(no topic)";
      break;
    }
    case "names": {
      const b = buffer(ev.channel);
      b.nicks = new Set(ev.nicks);
      if (state.active === b) renderNicks();
      break;
    }
    case "history": {
      const msgs = ev.entries.filter((e) => e.kind === "msg" || e.kind === "action" || e.kind === "notice");
      if (!msgs.length) break;
      sys(ev.channel, `--- ${msgs.length} earlier messages, recovered from the crypt ---`);
      for (const e of msgs) addLine(ev.channel, { ts: e.ts, nick: e.nick, text: e.text, cls: "history", isAction: e.kind === "action" });
      sys(ev.channel, "--- end of history ---");
      break;
    }
    case "list":
      sys(state.active ? state.active.name : SERVER, ev.channels.map((c) => `${c.name} (${c.users})${c.topic ? " " + c.topic : ""}`).join("  |  ") || "no channels");
      break;
    case "error":
      if (!state.nick) { el.loginHint.textContent = ev.text; break; }
      sys(state.active ? state.active.name : SERVER, `! ${ev.text}`, "err");
      break;
    case "server":
      sys(SERVER, ev.text);
      break;
  }
}

const HELP = [
  "/join #chan  /part [reason]  /me action  /msg nick text  /nick new  /topic [text]  /names  /list  /quote RAW IRC LINE",
  "Ghost commands: !ask <question>  !summary [n]  !tldr  !help  (or start a line with Ghost:)",
];

function runInput(text) {
  const b = state.active;
  const target = b ? b.name : SERVER;
  if (!text.startsWith("/") || text.startsWith("//")) {
    if (target === SERVER) return sys(SERVER, "Join a channel first: /join #seance", "err");
    const msg = text.startsWith("//") ? text.slice(1) : text;
    send({ type: "msg", target, text: msg });
    addLine(target, { nick: state.nick, text: msg });
    return;
  }
  const [cmd, ...rest] = text.slice(1).split(" ");
  const arg = rest.join(" ").trim();
  switch (cmd.toLowerCase()) {
    case "join": case "j": send({ type: "join", channel: arg.startsWith("#") ? arg : `#${arg}` }); break;
    case "part": case "leave": if (b && b.isChannel) send({ type: "part", channel: b.name, reason: arg || undefined }); break;
    case "me": send({ type: "action", target, text: arg }); addLine(target, { nick: state.nick, text: arg, cls: "action", isAction: true }); break;
    case "msg": case "query": {
      const [to, ...words] = rest; const t = words.join(" ");
      if (!to) break;
      buffer(to); setActive(to);
      if (t) { send({ type: "msg", target: to, text: t }); addLine(to, { nick: state.nick, text: t }); }
      break;
    }
    case "nick": send({ type: "nick", nick: arg }); break;
    case "topic": if (b && b.isChannel) send({ type: "topic", channel: b.name, topic: arg || undefined }); break;
    case "names": if (b && b.isChannel) send({ type: "names", channel: b.name }); break;
    case "list": send({ type: "list" }); break;
    case "quote": case "raw": send({ type: "raw", line: arg }); break;
    case "help": HELP.forEach((h) => sys(target, h)); break;
    default: sys(target, `Unknown command /${cmd}. Try /help`, "err");
  }
}

function connect(nick) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws = ws;
  el.status.textContent = "summoning..."; el.status.className = "status";
  ws.addEventListener("open", () => {
    el.status.textContent = `connected to ${state.info ? state.info.network : "server"}`; el.status.className = "status on";
    send({ type: "hello", nick });
  });
  ws.addEventListener("message", (m) => { try { handle(JSON.parse(m.data)); } catch (e) { console.error(e); } });
  ws.addEventListener("close", () => {
    el.status.textContent = "disconnected"; el.status.className = "status off";
    if (state.nick) sys(state.active ? state.active.name : SERVER, "Connection lost. Reload the page to reconnect.", "err");
    else el.loginHint.textContent = "Connection closed.";
  });
}

el.loginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const nick = el.nickInput.value.trim();
  if (!nick) return;
  el.loginHint.textContent = "";
  localStorage.setItem("seance.nick", nick);
  if (state.ws && state.ws.readyState === WebSocket.OPEN) send({ type: "nick", nick });
  else connect(nick);
});

el.inputForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = el.input.value;
  if (!text.trim()) return;
  state.history.push(text); state.historyPos = state.history.length;
  el.input.value = "";
  runInput(text);
});
el.input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp" && state.historyPos > 0) { state.historyPos--; el.input.value = state.history[state.historyPos]; e.preventDefault(); }
  if (e.key === "ArrowDown" && state.historyPos < state.history.length) { state.historyPos++; el.input.value = state.history[state.historyPos] ?? ""; e.preventDefault(); }
});
el.joinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const v = el.joinInput.value.trim();
  if (v) send({ type: "join", channel: v.startsWith("#") ? v : `#${v}` });
  el.joinInput.value = "";
});

(async function init() {
  el.nickInput.value = localStorage.getItem("seance.nick") || `wraith${Math.floor(Math.random() * 900 + 100)}`;
  try {
    state.info = await (await fetch("/api/info")).json();
    state.wanted = state.info.channels.map((c) => c.name).slice(0, 3);
    const host = state.info.ircHost || location.hostname;
    el.ircHint.textContent = `Real IRC clients welcome: ${host} port ${state.info.ircPort} (plain TCP). Ghost: ${state.info.ghost || "off"} via ${state.info.provider}.`;
    el.loginHint.textContent = `Channels: ${state.wanted.join(", ")}  |  AI: ${state.info.provider}`;
  } catch { state.wanted = ["#seance"]; }
  el.nickInput.focus();
})();
