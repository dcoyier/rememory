import { TOKEN_CHAR_RATIO } from "./constants.ts";

/** Rough token estimate. Used only to skip oversized block calls, never to truncate. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / TOKEN_CHAR_RATIO);
}

export function promptFitsWindow(input: {
  systemPrompt: string;
  userPrompt: string;
  contextWindow: number | undefined;
  outputReserve: number;
}): boolean {
  const window = input.contextWindow;
  if (!window || window <= 0) return true;
  const used =
    estimateTokens(input.systemPrompt) + estimateTokens(input.userPrompt) + input.outputReserve;
  return used <= window;
}
