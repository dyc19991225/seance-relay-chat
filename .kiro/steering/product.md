---
inclusion: always
---
<!-- Draft written outside Kiro as a starting point; refine it in Kiro. -->

# Product: Seance Relay Chat

Seance Relay Chat is a Kiroween 2026 entry in the **Resurrection** category
("Bring your favorite dead technology back to life"). The dead technology is
**IRC (Internet Relay Chat)**.

## What it is
- A real IRC server that speaks the RFC 1459 / RFC 2812 basics over plain TCP,
  so classic clients (irssi, HexChat, WeeChat) can connect on port 6667.
- A browser client that joins the *same* channels over a WebSocket bridge.
- **Ghost**, an AI assistant that lives in the channels as a normal IRC user and
  answers `!ask`, `!summary`, `!tldr` and direct mentions.
- A retro green-on-black terminal look with a light Halloween theme.

## Users
- People who remember IRC and want a quick, self-hosted room for a small group.
- People who never used IRC and can join from a browser with only a nickname.

## Principles
- Protocol first: anything a browser user sees must also be visible to a real IRC
  client, and vice versa. The browser is just another client of the same hub.
- No accounts and no registration. Nicknames are first come, first served.
- The AI is opt-in per message (commands or mentions). It never speaks unprompted
  and never answers NOTICEs.
- Bring your own official API keys; not a proxy for consumer subscriptions.
  A mock provider makes everything work with no key at all.
- Privacy: real client IPs are never shown; hosts are cloaked.

## Out of scope
- Server-to-server linking, services (NickServ/ChanServ), channel operators and
  bans, TLS on the IRC port itself (put a TLS terminator in front if needed).
- Any copyrighted assets, third-party logos or music.
