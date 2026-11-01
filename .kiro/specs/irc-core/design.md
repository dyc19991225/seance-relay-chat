<!-- Draft written outside Kiro as a starting point; refine it in Kiro. -->
# Design: IRC core

## Overview
The IRC logic lives in one transport-independent class, `ChatHub`
(`src/core/hub.ts`). Every connection – raw TCP, WebSocket, the Ghost bot and
test fakes – implements the small `Client` interface and exchanges parsed
`IrcMessage` objects with the hub. This keeps protocol behaviour identical for
all transports and lets most tests run without sockets.

```mermaid
flowchart LR
  TCP[TcpClient<br/>src/irc/tcp-server.ts] -->|IrcMessage| HUB[ChatHub]
  WS[WsClient<br/>src/web/ws-server.ts] -->|IrcMessage| HUB
  GHOST[GhostBot] -->|IrcMessage| HUB
  HUB -->|send()| TCP & WS & GHOST
  HUB -->|record()| DB[(SqliteHistory)]
```

## Components
| Module | Responsibility |
|---|---|
| `irc/message.ts` | `parseMessage`, `serializeMessage`, `LineBuffer` (CRLF/LF framing, 512-byte cap), `ircLower`, nick/channel validation |
| `irc/numerics.ts` | Named constants for replies and errors |
| `core/hub.ts` | Registration state machine, nick table, channels, command dispatch, broadcast, flood bucket, history hooks |
| `core/cloak.ts` | `cloakHost(kind, ip, salt)` → `irc-<hash>.spirit` / `web-<hash>.spirit` |
| `irc/tcp-server.ts` | `net.Server`, one `TcpClient` per socket, idle PING and timeout, max connections |
| `store/history.ts` | `node:sqlite` table `messages`, WAL mode, `recent(channel, n)`, retention prune |

## Data model
- `ClientState`: nick, user, realname, host cloak, registered flag, channels, flood bucket.
- `Channel`: display name, key (`ircLower`), topic + setter + time, members, `persistent` flag for default channels.
- `messages(id, ts, channel, chan_key, nick, kind, text)` with an index on `(chan_key, id)`.

## Error handling
- Parse errors drop the line silently (no reply), as real servers do.
- Unknown commands get 421 ERR_UNKNOWNCOMMAND after registration.
- Socket errors and timeouts go through the same `quit` path, so other users always see a QUIT.

## Testing strategy
- `test/protocol.test.ts`: parser/serializer round trips, length limits, case mapping, validators.
- `test/hub.test.ts`: registration, nick collisions, JOIN/PART/PRIVMSG/NOTICE/TOPIC/NAMES/QUIT via `FakeClient`.
- `test/e2e.test.ts`: real TCP and WebSocket sockets on ephemeral ports.
