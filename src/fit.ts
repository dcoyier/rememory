import { TOKEN_CHAR_RATIO } from "./constants.ts";

/** Rough token estimate for freeze metadata. Nested calls are never skipped or truncated by window size. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / TOKEN_CHAR_RATIO);
}
