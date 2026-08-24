import { BLOCK_MAX_TOKENS, DELIBERATION_MAX_TOKENS } from "./constants.ts";
import type { CompleteFn, LlmCall } from "./protocol.ts";
import {
  extractAssistantText,
  type NestedCompleteFn,
  type NestedCompleteOptions,
  type PiAssistantMessage,
  type PiExtensionContext,
  type PiModel,
} from "./pi-types.ts";

export interface CompleteFnExtras {
  getThinkingLevel?: () => string | undefined;
  /** Test hook. Production loads completeSimple from Pi's @mariozechner/pi-ai. */
  completeSimple?: NestedCompleteFn;
}

const PI_AI_SPECIFIERS = ["@mariozechner/pi-ai", "@earendil-works/pi-ai"] as const;

export function createCompleteFn(
  ctx: PiExtensionContext,
  model: PiModel,
  sessionId: string,
  extras?: CompleteFnExtras,
): CompleteFn {
  return async (call: LlmCall, signal?: AbortSignal) => {
    const maxTokens =
      call.maxTokens ?? (call.purpose === "block" ? BLOCK_MAX_TOKENS : DELIBERATION_MAX_TOKENS);
    const routingId =
      call.purpose === "block"
        ? `historical-memory:${sessionId}:block:${call.blockNumber}`
        : `historical-memory:${sessionId}:deliberation`;

    const options: NestedCompleteOptions = {
      maxTokens,
      signal,
      sessionId: routingId,
      cacheRetention: "none",
      ...reasoningOptions(model, extras?.getThinkingLevel?.() ?? ctx.thinkingLevel),
    };

    const response = await runNestedComplete(ctx, model, extras, {
      systemPrompt: call.systemPrompt,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: call.userPrompt }],
          timestamp: Date.now(),
        },
      ],
    }, options);

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

/**
 * Reasoning models (Codex, o-series, GPT-5, ox-alpha) reject omitted/disabled effort.
 * Always send at least "low" when the model flags reasoning. completeSimple maps the
 * unified `reasoning` field per provider; raw complete() reads `reasoningEffort`.
 */
export function reasoningOptions(
  model: PiModel,
  thinkingLevel: string | undefined,
): Pick<NestedCompleteOptions, "reasoning" | "reasoningEffort"> {
  if (!model.reasoning) return {};
  const level = thinkingLevel && thinkingLevel !== "off" ? thinkingLevel : "low";
  return { reasoning: level, reasoningEffort: level };
}

async function runNestedComplete(
  ctx: PiExtensionContext,
  model: PiModel,
  extras: CompleteFnExtras | undefined,
  context: { systemPrompt?: string; messages: unknown[] },
  options: NestedCompleteOptions,
): Promise<PiAssistantMessage> {
  if (typeof ctx.modelRegistry.complete === "function") {
    return ctx.modelRegistry.complete(model, context, options);
  }

  const authFn = ctx.modelRegistry.getApiKeyAndHeaders;
  if (typeof authFn !== "function") {
    throw new Error("historical-memory: model registry cannot complete nested calls");
  }
  const auth = await authFn(model);
  if (!auth || auth.ok === false) {
    throw new Error(auth?.error || "historical-memory: no credentials for nested memory call");
  }
  if (!auth.apiKey) {
    throw new Error(
      `historical-memory: no API key for "${model.provider}". For Codex, run /login openai-codex.`,
    );
  }

  const completeSimple = extras?.completeSimple ?? (await importCompleteSimple());
  return completeSimple(model, context, {
    ...options,
    apiKey: auth.apiKey,
    headers: auth.headers,
  });
}

async function importCompleteSimple(): Promise<NestedCompleteFn> {
  const errors: string[] = [];
  for (const name of PI_AI_SPECIFIERS) {
    const specifier: string = name;
    try {
      const mod = (await import(specifier)) as { completeSimple?: NestedCompleteFn };
      if (typeof mod.completeSimple === "function") return mod.completeSimple;
      errors.push(`${specifier} has no completeSimple`);
    } catch (error) {
      errors.push(`${specifier}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(
    `historical-memory: completeSimple is unavailable (${errors.join("; ")}). Nested memory calls need Pi's LLM complete helper so Codex OAuth and other provider auth resolve.`,
  );
}
