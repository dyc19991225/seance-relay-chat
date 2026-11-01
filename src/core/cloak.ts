import { createHash, randomUUID } from "node:crypto";

/** Hide the real address: users see a stable per-IP hash, never the IP itself. */
export function cloakHost(kind: string, ip: string | undefined, salt: string): string {
  const h = createHash("sha256").update(salt + "|" + (ip ?? "unknown")).digest("hex").slice(0, 10);
  return `${kind}-${h}.spirit`;
}

export function newId(): string {
  return randomUUID();
}
