---
inclusion: fileMatch
fileMatchPattern: ["src/**/*.ts", "web/**/*.js", "deploy/**", "docker-compose.yml", ".env.example"]
---
<!-- Draft written outside Kiro as a starting point; refine it in Kiro. -->

# Security rules

- Treat every byte from a socket as hostile: enforce the 512-byte IRC line limit,
  the 8 KB WebSocket payload limit and the per-client flood bucket.
- Strip CR, LF and NUL from anything that is written into an IRC line.
- Browser code must render chat text with `textContent`, never `innerHTML`.
- Chat transcripts sent to the model are untrusted data; the system prompt says so.
- API keys come only from environment variables. Do not hard-code, log, or echo
  them, and do not include upstream error bodies in logs or chat.
- This project calls official APIs with the operator's own key. It must never act
  as a reverse proxy for Kiro or any consumer subscription account.
