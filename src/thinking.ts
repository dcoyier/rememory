/** Thinking block as stored by Pi (plaintext, summary, or encrypted). */
export type ThinkingBlock = {
  type?: string;
  thinking?: unknown;
  thinkingSignature?: unknown;
  redacted?: unknown;
};

/**
 * Encrypted / redacted reasoning is opaque provider state. It is not useful to a
 * memory agent, and dumping it into prompts wastes the window (or 400s another model).
 */
export function isReadableThinking(block: ThinkingBlock | null | undefined): boolean {
  if (!block || block.type !== "thinking") return false;
  if (block.redacted === true) return false;
  if (typeof block.thinking !== "string") return false;
  const text = block.thinking.trim();
  if (!text) return false;
  if (looksEncryptedThinking(text)) return false;
  return true;
}

export function looksEncryptedThinking(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed === "[Reasoning redacted]") return true;
  if (trimmed.startsWith("{") && /"encrypted_content"\s*:/.test(trimmed)) return true;
  if (trimmed.startsWith("{") && /"type"\s*:\s*"reasoning"/.test(trimmed) && /"encrypted/.test(trimmed)) {
    return true;
  }
  // Long opaque token (base64 / JWT-like) with no prose.
  const compact = trimmed.replace(/\s+/g, "");
  if (compact.length >= 200 && /^[A-Za-z0-9+/_=-]+$/.test(compact) && !/\s/.test(trimmed)) {
    return true;
  }
  return false;
}
