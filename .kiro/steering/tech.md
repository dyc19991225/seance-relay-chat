---
inclusion: always
---
<!-- Draft written outside Kiro as a starting point; refine it in Kiro. -->

# Tech stack

- **Runtime:** Node.js >= 22.13 (uses the built-in `node:sqlite` module, so no
  native addons are compiled). Developed on Node 24.
- **Language:** TypeScript (strict, `noUncheckedIndexedAccess`), ESM with
  `module: NodeNext`. Relative imports use the `.js` extension.
- **Runtime dependency:** `ws` only. Everything else is the Node standard library
  (`node:net`, `node:http`, `node:sqlite`, `node:crypto`).
- **Dev tooling:** `typescript`, `tsx`, `@types/node`, `@types/ws`.
- **Tests:** `node:test` + `node:assert/strict`, run through `tsx`
  (`npm test`). No test framework dependency.
- **Frontend:** plain HTML, CSS and one ES module (`web/app.js`). No bundler,
  no framework, no web fonts (system monospace stack only).
- **Storage:** SQLite file (WAL mode) for channel history.
- **AI:** any OpenAI-compatible `/chat/completions` endpoint, configured via
  `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`. `AI_PROVIDER=mock` for offline use.
- **Packaging:** Dockerfile (multi-stage) + docker-compose with Caddy for
  HTTPS/WSS.

## Commands
- `npm run dev` – run from source with tsx
- `npm run build` – compile to `dist/`
- `npm start` – run the compiled server
- `npm test` – unit + end-to-end tests (ephemeral ports, in-memory SQLite)
- `npm run typecheck` – type-check src, tests and scripts
- `npm run smoke -- <host> <ircPort> <httpPort>` – live check against a running server

## Rules
- Never commit secrets. Configuration comes from environment variables;
  `.env.example` holds placeholders only.
- Never log API keys or upstream response bodies.
- Keep every outgoing IRC line within 512 bytes including CRLF.
