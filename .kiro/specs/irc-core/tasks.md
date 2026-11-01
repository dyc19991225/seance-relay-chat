<!-- Draft written outside Kiro. Items are checked because the code for them already exists in this repo. -->
# Tasks: IRC core

- [x] 1. Line protocol
  - [x] 1.1 Implement `parseMessage` / `serializeMessage` with tag skipping and the 512-byte limit
  - [x] 1.2 Implement `LineBuffer` for CRLF and bare-LF framing
  - [x] 1.3 Implement `ircLower`, `isValidNick`, `isValidChannel`
  - [x] 1.4 Unit tests in `test/protocol.test.ts`
  - _Requirements: 1.1–1.5_
- [x] 2. Hub registration
  - [x] 2.1 NICK/USER/CAP/PING handling and welcome burst (001–005, MOTD)
  - [x] 2.2 Nick collision and validation errors (432, 433, 451, 461, 462)
  - [x] 2.3 Nick change broadcast to shared channels
  - _Requirements: 2.1–2.6_
- [x] 3. Channels and messaging
  - [x] 3.1 JOIN/PART with topic and NAMES replies, persistent default channels
  - [x] 3.2 PRIVMSG/NOTICE routing with 401/404/411/412
  - [x] 3.3 TOPIC, LIST, WHO, MODE (read-only) replies
  - [x] 3.4 History recording through `HistorySink`
  - _Requirements: 3.1–3.7, 4.1–4.6_
- [x] 4. TCP transport and liveness
  - [x] 4.1 `startTcpServer` with idle PING and timeout
  - [x] 4.2 Flood token bucket and host cloaking
  - _Requirements: 5.1–5.6_
- [ ] 5. Follow-ups (not implemented)
  - [ ] 5.1 Optional TLS listener on 6697
  - [x] 5.2 Channel operators and KICK
