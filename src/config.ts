import { randomBytes } from "node:crypto";

export interface Config {
  ircHost: string;
  ircPort: number;
  httpHost: string;
  httpPort: number;
  serverName: string;
  networkName: string;
  defaultChannels: string[];
  motd: string[];
  dbPath: string;
  historyOnJoin: number;
  historyRetentionDays: number;
  cloakSalt: string;
  allowedOrigins: string[];
  publicIrcHost: string;
  ghost: {
    enabled: boolean;
    nick: string;
    cooldownMs: number;
    maxReplyLines: number;
    summaryDefault: number;
    summaryMax: number;
    maxConcurrent: number;
  };
  ai: {
    provider: "mock" | "openai";
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: number;
    maxTokens: number;
  };
}

function int(env: NodeJS.ProcessEnv, key: string, def: number): number {
  const v = env[key];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
  return n;
}

function list(v: string | undefined, def: string[]): string[] {
  if (v === undefined || v.trim() === "") return def;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.AI_API_KEY ?? "";
  const requested = (env.AI_PROVIDER ?? "").toLowerCase();
  // Default to the mock provider unless a key is configured (or a keyless local endpoint is requested).
  const provider: "mock" | "openai" = requested === "openai" || (requested === "" && apiKey) ? "openai" : "mock";
  return {
    ircHost: env.IRC_HOST || "0.0.0.0",
    ircPort: int(env, "IRC_PORT", 6667),
    httpHost: env.HTTP_HOST || "0.0.0.0",
    httpPort: int(env, "HTTP_PORT", 8080),
    serverName: env.SERVER_NAME || "seance.local",
    networkName: env.NETWORK_NAME || "SeanceNet",
    defaultChannels: list(env.DEFAULT_CHANNELS, ["#seance", "#crypt"]),
    motd: list(env.MOTD, [
      "Welcome to Seance Relay Chat.",
      "IRC (1988) lives again: plain TCP on port 6667, or the web client.",
      "Say !help in any channel to summon the Ghost.",
    ]).map((s) => s.slice(0, 200)),
    dbPath: env.DB_PATH || "./data/seance.db",
    historyOnJoin: int(env, "HISTORY_ON_JOIN", 50),
    historyRetentionDays: int(env, "HISTORY_RETENTION_DAYS", 30),
    cloakSalt: env.CLOAK_SALT || randomBytes(16).toString("hex"),
    allowedOrigins: list(env.ALLOWED_ORIGINS, []),
    publicIrcHost: env.PUBLIC_IRC_HOST ?? "",
    ghost: {
      enabled: (env.GHOST_ENABLED || "true") !== "false",
      nick: env.GHOST_NICK || "Ghost",
      cooldownMs: int(env, "GHOST_COOLDOWN_MS", 5000),
      maxReplyLines: int(env, "GHOST_MAX_LINES", 5),
      summaryDefault: int(env, "GHOST_SUMMARY_DEFAULT", 50),
      summaryMax: int(env, "GHOST_SUMMARY_MAX", 200),
      maxConcurrent: int(env, "GHOST_MAX_CONCURRENT", 3),
    },
    ai: {
      provider,
      baseUrl: env.AI_BASE_URL || "https://api.openai.com/v1",
      apiKey,
      model: env.AI_MODEL || "gpt-4o-mini",
      timeoutMs: int(env, "AI_TIMEOUT_MS", 30000),
      maxTokens: int(env, "AI_MAX_TOKENS", 400),
    },
  };
}
