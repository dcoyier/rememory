import { BLOCK_MAX_TOKENS, DELIBERATION_MAX_TOKENS } from "./constants.ts";
import type { CompleteFn, LlmCall } from "./protocol.ts";
import {
  extractAssistantText,
  type PiExtensionContext,
  type PiModel,
} from "./pi-types.ts";

export function createCompleteFn(
  ctx: PiExtensionContext,
  model: PiModel,
  sessionId: string,
): CompleteFn {
  return async (call: LlmCall, signal?: AbortSignal) => {
    const maxTokens =
      call.maxTokens ?? (call.purpose === "block" ? BLOCK_MAX_TOKENS : DELIBERATION_MAX_TOKENS);
    const routingId =
      call.purpose === "block"
        ? `historical-memory:${sessionId}:block:${call.blockNumber}`
        : `historical-memory:${sessionId}:deliberation`;

    const response = await ctx.modelRegistry.complete(
      model,
      {
        systemPrompt: call.systemPrompt,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: call.userPrompt }],
            timestamp: Date.now(),
          },
        ],
      },
      {
        maxTokens,
        signal,
        sessionId: routingId,
        cacheRetention: "none",
        // Ox-alpha and similar endpoints reject requests that disable reasoning.
        ...(model.reasoning
          ? {
              reasoning:
                ctx.thinkingLevel && ctx.thinkingLevel !== "off" ? ctx.thinkingLevel : "low",
            }
          : {}),
      },
    );

    if (response.stopReason === "aborted") {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    if (response.stopReason === "error") {
      throw new Error(response.errorMessage || "memory model call failed");
    }
    return extractAssistantText(response);
  };
}
