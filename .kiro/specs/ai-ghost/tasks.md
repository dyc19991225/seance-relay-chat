<!-- Draft written outside Kiro. Items are checked because the code for them already exists in this repo. -->
# Tasks: Ghost

- [x] 1. Command parsing
  - [x] 1.1 `parseGhostCommand` for !ask, !summary [n], !tldr, !help and mentions
  - [x] 1.2 `stripFormatting`, `formatTranscript`, `toIrcLines`
  - _Requirements: 1.1–1.5, 1.8, 2.2, 4.4_
- [x] 2. Providers
  - [x] 2.1 `OpenAiCompatibleProvider` with timeout and safe error messages
  - [x] 2.2 Deterministic `MockProvider`
  - [x] 2.3 Provider selection from env in `config.ts` / `app.ts`
  - _Requirements: 3.3, 4.1–4.3_
- [x] 3. GhostBot client
  - [x] 3.1 Join default channels, react to PRIVMSG only
  - [x] 3.2 Per-nick cooldown and concurrency cap
  - [x] 3.3 Reply after the triggering line
  - [x] 3.4 Tests in `test/ghost.test.ts`
  - _Requirements: 1.6, 1.7, 2.1, 2.3, 3.1, 3.2_
- [ ] 4. Follow-ups (not implemented)
  - [ ] 4.1 Daily per-channel token budget
  - [ ] 4.2 Streaming replies
