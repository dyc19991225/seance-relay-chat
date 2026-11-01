export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type GhostTask = "ask" | "summary" | "tldr";

export interface CompleteOptions {
  task: GhostTask;
  maxTokens?: number;
}

export interface AiProvider {
  readonly name: string;
  complete(messages: ChatMessage[], opts: CompleteOptions): Promise<string>;
}

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  temperature?: number;
}

/**
 * Calls any OpenAI-compatible Chat Completions endpoint with the operator's
 * own official API key (OpenAI, DeepSeek, a local Ollama/vLLM server, ...).
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = "openai-compatible";
  constructor(private readonly cfg: OpenAiCompatibleConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  async complete(messages: ChatMessage[], opts: CompleteOptions): Promise<string> {
    const url = this.cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.cfg.apiKey) headers.authorization = `Bearer ${this.cfg.apiKey}`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.cfg.model,
        messages,
        max_tokens: opts.maxTokens ?? this.cfg.maxTokens,
        temperature: this.cfg.temperature ?? 0.6,
      }),
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });
    if (!res.ok) {
      // Never echo the response body: it could contain account details.
      throw new Error(`AI provider returned HTTP ${res.status}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content;
    if (!text || typeof text !== "string") throw new Error("AI provider returned no content");
    return text.trim();
  }
}

const STOPWORDS = new Set(
  ("a an and are as at be but by for from has have i if in is it its me my no not of on or our so that the " +
    "their them then there they this to too up us was we were what when where which who why will with you your " +
    "just like can do does did dont im its ok yes yeah lol get got").split(" "),
);

/** Parse transcript lines of the form "[HH:MM] <nick> text". */
export function parseTranscript(text: string): Array<{ nick: string; text: string }> {
  const out: Array<{ nick: string; text: string }> = [];
  for (const line of text.split("\n")) {
    const m = /^\[[^\]]*\] <([^>]+)> (.*)$/.exec(line.trim());
    if (m) out.push({ nick: m[1]!, text: m[2]! });
  }
  return out;
}

export function topWords(lines: Array<{ text: string }>, n: number): string[] {
  const counts = new Map<string, number>();
  for (const l of lines) {
    for (const w of l.text.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) ?? []) {
      const word = w.replace(/'/g, "");
      if (STOPWORDS.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([w]) => w);
}

/**
 * Deterministic offline provider. Lets the whole app run and be demoed with
 * no API key, and makes the bot fully testable.
 */
export class MockProvider implements AiProvider {
  readonly name = "mock";

  async complete(messages: ChatMessage[], opts: CompleteOptions): Promise<string> {
    const user = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    if (opts.task === "ask") {
      const q = user.split("\n").pop()?.replace(/^Question:\s*/i, "").trim() ?? "";
      return `[mock] The spirits heard: "${q.slice(0, 120)}". I am running on the mock provider, so this is a canned reply. Set AI_API_KEY to wake a real model.`;
    }
    const lines = parseTranscript(user);
    if (lines.length === 0) return "[mock] The channel is silent as a tomb. Nothing to summarize.";
    const perNick = new Map<string, number>();
    for (const l of lines) perNick.set(l.nick, (perNick.get(l.nick) ?? 0) + 1);
    const ranked = [...perNick.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const words = topWords(lines, 3);
    const topics = words.length ? words.join(", ") : "nothing in particular";
    if (opts.task === "tldr") {
      return `[mock] TL;DR: ${lines.length} messages from ${ranked.length} souls, mostly about ${topics}.`;
    }
    const last = lines[lines.length - 1]!;
    return [
      `[mock] Summary of the last ${lines.length} messages from ${ranked.length} souls (${ranked.map(([n]) => n).join(", ")}).`,
      `Loudest spirit: ${ranked[0]![0]} (${ranked[0]![1]} messages). Recurring words: ${topics}.`,
      `Last words: <${last.nick}> ${last.text.slice(0, 100)}`,
    ].join("\n");
  }
}
