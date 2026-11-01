/**
 * IRC message parsing and serialization (RFC 1459 / RFC 2812 section 2.3).
 *
 *   message = [ ":" prefix SPACE ] command [ params ] crlf
 *   params  = *14( SPACE middle ) [ SPACE ":" trailing ]
 *
 * IRCv3 message tags ("@a=b;c ") are tolerated on input and ignored.
 */

export interface IrcMessage {
  prefix?: string;
  command: string;
  params: string[];
}

/** Maximum length of a single IRC line including the trailing CRLF. */
export const MAX_LINE_BYTES = 512;

export function parseMessage(rawLine: string): IrcMessage | null {
  let line = rawLine.replace(/[\r\n]+$/, "");
  if (line.length === 0) return null;

  let pos = 0;
  // Skip IRCv3 tags if a client sends them.
  if (line[0] === "@") {
    const sp = line.indexOf(" ");
    if (sp === -1) return null;
    pos = sp + 1;
    while (line[pos] === " ") pos++;
  }

  let prefix: string | undefined;
  if (line[pos] === ":") {
    const sp = line.indexOf(" ", pos);
    if (sp === -1) return null;
    prefix = line.slice(pos + 1, sp);
    pos = sp + 1;
    while (line[pos] === " ") pos++;
  }

  line = line.slice(pos);
  const params: string[] = [];
  let command = "";

  const trailingIdx = line.indexOf(" :");
  let head = line;
  let trailing: string | undefined;
  if (line.startsWith(":")) {
    return null; // command cannot start with ':'
  }
  if (trailingIdx !== -1) {
    head = line.slice(0, trailingIdx);
    trailing = line.slice(trailingIdx + 2);
  }
  const parts = head.split(" ").filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  command = parts.shift()!.toUpperCase();
  if (!/^([A-Z]+|\d{3})$/.test(command)) return null;
  params.push(...parts);
  if (trailing !== undefined) params.push(trailing);

  const msg: IrcMessage = { command, params };
  if (prefix !== undefined) msg.prefix = prefix;
  return msg;
}

/** Serialize a message into a single IRC line (without CRLF). */
export function serializeMessage(msg: IrcMessage): string {
  const out: string[] = [];
  if (msg.prefix) out.push(":" + msg.prefix);
  out.push(msg.command);
  msg.params.forEach((p, i) => {
    const clean = p.replace(/[\r\n\0]/g, " ");
    const isLast = i === msg.params.length - 1;
    if (isLast && (clean === "" || clean.includes(" ") || clean.startsWith(":"))) {
      out.push(":" + clean);
    } else {
      out.push(clean);
    }
  });
  return truncateBytes(out.join(" "), MAX_LINE_BYTES - 2);
}

export function truncateBytes(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, "utf8") <= maxBytes) return s;
  let buf = Buffer.from(s, "utf8").subarray(0, maxBytes);
  // Avoid cutting a multi-byte UTF-8 sequence in half.
  let str = buf.toString("utf8");
  while (str.endsWith("\uFFFD") && buf.length > 0) {
    buf = buf.subarray(0, buf.length - 1);
    str = buf.toString("utf8");
  }
  return str;
}

/**
 * Splits an incoming TCP byte stream into lines. Accepts CRLF and bare LF
 * (many hand-typed `nc` sessions only send LF).
 */
export class LineBuffer {
  private buf = "";
  constructor(private readonly maxLine = 8192) {}

  push(chunk: string): string[] {
    this.buf += chunk;
    const lines: string[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) !== -1) {
      let line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      lines.push(line);
    }
    if (this.buf.length > this.maxLine) {
      // Drop an over-long partial line rather than buffering forever.
      this.buf = "";
    }
    return lines;
  }
}

/** RFC 1459 case mapping: A-Z [ ] \ ~ map to a-z { } | ^ */
export function ircLower(s: string): string {
  return s.replace(/[A-Z\[\]\\~]/g, (c) => {
    switch (c) {
      case "[": return "{";
      case "]": return "}";
      case "\\": return "|";
      case "~": return "^";
      default: return c.toLowerCase();
    }
  });
}

/** RFC 2812 nickname: ( letter / special ) *8( letter / digit / special / "-" ); we allow up to 20. */
export function isValidNick(nick: string): boolean {
  return /^[A-Za-z\[\]\\`_^{|}][A-Za-z0-9\[\]\\`_^{|}-]{0,19}$/.test(nick);
}

/** Channel names: '#' followed by 1-49 chars, no space, comma, BELL or ':'. */
export function isValidChannel(name: string): boolean {
  return /^#[^\s,\x07:]{1,49}$/.test(name);
}
