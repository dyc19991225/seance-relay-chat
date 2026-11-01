---
inclusion: always
---
<!-- Draft written outside Kiro as a starting point; refine it in Kiro. -->

# Project structure

```
src/
  index.ts            entry point: load config, start app, handle signals
  app.ts              wires hub + TCP server + HTTP/WS server + Ghost
  config.ts           environment variable parsing and defaults
  irc/
    message.ts        IRC line parser/serializer, LineBuffer, nick/channel rules
    numerics.ts       RPL_* / ERR_* numeric constants
    tcp-server.ts     raw TCP listener (port 6667), ping/idle timers
  core/
    types.ts          Client interface, history types
    hub.ts            ChatHub: transport-independent IRC command handling
    cloak.ts          host cloaking and ids
  store/
    history.ts        SQLite history (node:sqlite)
  web/
    bridge.ts         JSON <-> IRC translation for browser clients
    ws-server.ts      WebSocket endpoint (/ws), history on join
    http-server.ts    static files, /healthz, /api/info, security headers
  ghost/
    ghost.ts          Ghost bot: command parsing, rate limits, IRC output
    providers.ts      OpenAI-compatible provider and offline mock provider
web/                  browser client (index.html, style.css, app.js, favicon.svg)
test/                 node:test suites (protocol, hub, bridge, ghost, e2e)
scripts/              smoke test against a live server
deploy/               Caddyfile and deployment notes
.kiro/                steering, specs and hooks
```

## Conventions
- Every connection type (TCP, WebSocket, the Ghost bot, test fakes) implements
  the `Client` interface and talks to `ChatHub` using IRC messages. New
  transports must not add special cases inside the hub.
- The hub is pure logic with no sockets; test it with `FakeClient` from
  `test/helpers.ts`.
- Each source module has a matching test file or is covered by `e2e.test.ts`.
