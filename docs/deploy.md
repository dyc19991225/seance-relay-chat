# Deploying Seance Relay Chat on a VPS

This guide assumes a small Linux VPS with Docker Engine and the Docker Compose
plugin installed, and a domain name you control (`seance.example.com` below).

> These steps were written for this repository but have not been run on a real
> VPS yet. The Caddyfile was checked with `caddy adapt`, and WebSocket proxying
> through Caddy was tested locally over plain HTTP.

## 1. DNS
Create an `A` (and optionally `AAAA`) record for `seance.example.com` pointing at
the VPS public IP. Caddy needs it to obtain a certificate.

## 2. Firewall
Open these inbound ports:

| Port | Protocol | Used by |
|---|---|---|
| 80 | TCP | Caddy (ACME HTTP challenge, redirect to HTTPS) |
| 443 | TCP + UDP | Caddy (HTTPS, WSS, HTTP/3) |
| 6667 | TCP | IRC clients (irssi, HexChat, WeeChat) |

Example with `ufw`:
```sh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw allow 6667/tcp
```

Port 8080 stays internal; only Caddy talks to it.

## 3. Configure
```sh
git clone <your-repo-url> seance-relay-chat
cd seance-relay-chat
cp .env.example .env
# edit .env: DOMAIN, SERVER_NAME, PUBLIC_IRC_HOST, ALLOWED_ORIGINS, CLOAK_SALT
openssl rand -hex 32   # paste as CLOAK_SALT
```

For a real model, set `AI_PROVIDER=openai`, `AI_BASE_URL`, `AI_API_KEY` and
`AI_MODEL` in `.env` with your own official API key. Bring your own official
API keys; not a proxy for consumer subscriptions. Set a spending limit on that
key in your provider's dashboard, because anyone in the channel can call `!ask`.

## 4. Start
```sh
docker compose up -d --build
docker compose logs -f app
```

Check:
- `https://seance.example.com/healthz` returns `{"ok":true,...}`
- the web client loads at `https://seance.example.com/` and connects over `wss://`
- an IRC client connects: `/connect seance.example.com 6667` (irssi) or add the
  server in HexChat's Network List with port 6667 and SSL unchecked

## 5. Operate
- History lives in the `seance-data` volume (`/data/seance.db`); entries older
  than `HISTORY_RETENTION_DAYS` are pruned each time the app starts.
- Update: `git pull && docker compose up -d --build`.
- Backup: run `docker compose stop app`, copy the `seance-data` volume
  contents (e.g. with `docker run --rm -v <project>_seance-data:/data -v "$PWD":/backup busybox cp -a /data /backup/`),
  then `docker compose start app`.

## Notes
- The IRC port is plain text, like classic IRC. If you want TLS for IRC clients,
  put a TCP TLS terminator (e.g. stunnel or a Caddy layer4 build) on 6697 in
  front of 6667. This is not included.
- Web users' host cloaks use the `X-Forwarded-For` header that Caddy sets.
