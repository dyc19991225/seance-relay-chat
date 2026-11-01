<!-- Draft written outside Kiro. Items are checked because the code for them already exists in this repo. -->
# Tasks: Web client and WebSocket bridge

- [x] 1. Bridge protocol
  - [x] 1.1 Define `WsCommand` / `WsEvent` types and `parseWsCommand` validation
  - [x] 1.2 Implement `wsCommandToIrc` with CR/LF/NUL stripping and clipping
  - [x] 1.3 Implement `IrcToWs` with NAMES and LIST aggregation
  - [x] 1.4 Unit tests in `test/bridge.test.ts`
  - _Requirements: 1.1–1.5, 2.2, 2.3_
- [x] 2. WebSocket server
  - [x] 2.1 Upgrade handling on `/ws`, Origin allow-list, 8 KB max payload
  - [x] 2.2 History replay on join
  - [x] 2.3 Heartbeat and cleanup on close
  - _Requirements: 1.6, 2.1, 2.4, 3.1_
- [x] 3. HTTP server
  - [x] 3.1 Static file serving with traversal guard and security headers
  - [x] 3.2 `/healthz` and `/api/info`
  - _Requirements: 4.1, 4.8_
- [x] 4. Browser UI
  - [x] 4.1 Login overlay, buffers, nick list, status bar
  - [x] 4.2 Slash commands and input history
  - [x] 4.3 Spooky retro theme with reduced-motion support
  - [x] 4.4 Keep focus on the first auto-joined channel
  - _Requirements: 3.2, 4.2–4.7_
- [ ] 5. Follow-ups (not implemented)
  - [ ] 5.1 Reconnect with backoff after a dropped connection
  - [ ] 5.2 Mobile layout for the channel and nick columns
