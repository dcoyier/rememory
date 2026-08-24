import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCompleteFn } from "../src/llm.ts";
import { extractAssistantText, type PiAssistantMessage, type PiExtensionContext, type PiModel } from "../src/pi-types.ts";

const model: PiModel = { id: "m", provider: "p", contextWindow: 100_000 };

function ctxWith(
  response: PiAssistantMessage,
  onComplete?: (options: unknown) => void,
): PiExtensionContext {
  return {
    cwd: "/tmp",
    model,
    modelRegistry: {
      async complete(_model, _context, options) {
        onComplete?.(options);
        return response;
      },
    },
    sessionManager: {},
    ui: {},
  };
}

describe("createCompleteFn", () => {
  it("falls back to thinking text when there is no visible text", async () => {
    const complete = createCompleteFn(
      ctxWith({
        role: "assistant",
        content: [{ type: "thinking", thinking: "yes\nUse the vault path." }],
      }),
      model,
      "sess",
    );
    const text = await complete({
      purpose: "block",
      blockNumber: 1,
      systemPrompt: "s",
      userPrompt: "u",
    });
    assert.equal(text, "yes\nUse the vault path.");
  });

  it("extracts assistant text", async () => {
    const complete = createCompleteFn(
      ctxWith({ role: "assistant", content: [{ type: "text", text: "yes\nHello" }] }),
      model,
      "sess",
    );
    const text = await complete({
      purpose: "block",
      blockNumber: 1,
      systemPrompt: "s",
      userPrompt: "u",
    });
    assert.equal(text, "yes\nHello");
  });

  it("turns stopReason aborted into AbortError", async () => {
    const complete = createCompleteFn(
      ctxWith({ role: "assistant", content: [], stopReason: "aborted" }),
      model,
      "sess",
    );
    await assert.rejects(
      () => complete({ purpose: "deliberation", round: 2, systemPrompt: "s", userPrompt: "u" }),
      (err: unknown) => err instanceof Error && err.name === "AbortError",
    );
  });

  it("throws on model error stopReason", async () => {
    const complete = createCompleteFn(
      ctxWith({
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "provider down",
      }),
      model,
      "sess",
    );
    await assert.rejects(
      () => complete({ purpose: "block", blockNumber: 1, systemPrompt: "s", userPrompt: "u" }),
      /provider down/,
    );
  });

  it("enables reasoning on nested completes when the model requires it", async () => {
    const reasoningModel: PiModel = { ...model, reasoning: true };
    let options: { reasoningEffort?: string } | undefined;
    const complete = createCompleteFn(
      {
        ...ctxWith({ role: "assistant", content: [{ type: "text", text: "no" }] }, (opts) => {
          options = opts as { reasoningEffort?: string };
        }),
        thinkingLevel: "low",
        model: reasoningModel,
      },
      reasoningModel,
      "sess",
    );
    await complete({ purpose: "block", blockNumber: 1, systemPrompt: "s", userPrompt: "u" });
    assert.equal(options?.reasoningEffort, "low");
  });

  it("disables prompt cache retention on nested completes", async () => {
    let options: { cacheRetention?: string } | undefined;
    const complete = createCompleteFn(
      ctxWith({ role: "assistant", content: [{ type: "text", text: "no" }] }, (opts) => {
        options = opts as { cacheRetention?: string };
      }),
      model,
      "sess",
    );
    await complete({ purpose: "block", blockNumber: 1, systemPrompt: "s", userPrompt: "u" });
    assert.equal(options?.cacheRetention, "none");
  });

  it("does not treat encrypted reasoning as the answer", async () => {
    const complete = createCompleteFn(
      ctxWith({
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "",
            thinkingSignature: JSON.stringify({
              type: "reasoning",
              encrypted_content: "gAAAAABnot-the-note",
            }),
          },
        ],
      }),
      { ...model, reasoning: true },
      "sess",
    );
    const text = await complete({
      purpose: "block",
      blockNumber: 1,
      systemPrompt: "s",
      userPrompt: "u",
    });
    assert.equal(text, "");
  });

  it("prefers visible text over encrypted thinking", () => {
    assert.equal(
      extractAssistantText({
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "",
            thinkingSignature: JSON.stringify({ type: "reasoning", encrypted_content: "cipher" }),
          },
          { type: "text", text: "yes\nUse staging." },
        ],
      }),
      "yes\nUse staging.",
    );
  });

  it("resolves Codex-style OAuth through getApiKeyAndHeaders + completeSimple", async () => {
    const reasoningModel: PiModel = {
      ...model,
      provider: "openai-codex",
      id: "gpt-5.3-codex",
      reasoning: true,
    };
    let seen: { apiKey?: string; reasoning?: string; reasoningEffort?: string } | undefined;
    const complete = createCompleteFn(
      {
        cwd: "/tmp",
        model: reasoningModel,
        thinkingLevel: "off",
        modelRegistry: {
          async getApiKeyAndHeaders() {
            return { ok: true as const, apiKey: "codex-oauth-token", headers: { "ChatGPT-Account-Id": "acct" } };
          },
        },
        sessionManager: {},
        ui: {},
      },
      reasoningModel,
      "sess",
      {
        async completeSimple(_model, _context, options) {
          seen = {
            apiKey: options?.apiKey,
            reasoning: options?.reasoning,
            reasoningEffort: options?.reasoningEffort,
          };
          return { role: "assistant", content: [{ type: "text", text: "no" }] };
        },
      },
    );
    await complete({ purpose: "block", blockNumber: 1, systemPrompt: "s", userPrompt: "u" });
    assert.equal(seen?.apiKey, "codex-oauth-token");
    assert.equal(seen?.reasoning, "low");
    assert.equal(seen?.reasoningEffort, "low");
  });

  it("surfaces Codex auth failures from getApiKeyAndHeaders", async () => {
    const reasoningModel: PiModel = { ...model, provider: "openai-codex", reasoning: true };
    const complete = createCompleteFn(
      {
        cwd: "/tmp",
        model: reasoningModel,
        modelRegistry: {
          async getApiKeyAndHeaders() {
            return { ok: false as const, error: "No API key found for \"openai-codex\"" };
          },
        },
        sessionManager: {},
        ui: {},
      },
      reasoningModel,
      "sess",
      {
        async completeSimple() {
          throw new Error("completeSimple should not run without auth");
        },
      },
    );
    await assert.rejects(
      () => complete({ purpose: "block", blockNumber: 1, systemPrompt: "s", userPrompt: "u" }),
      /No API key found for "openai-codex"/,
    );
  });

  it("rejects Codex auth that is ok but has no token", async () => {
    const reasoningModel: PiModel = { ...model, provider: "openai-codex", reasoning: true };
    const complete = createCompleteFn(
      {
        cwd: "/tmp",
        model: reasoningModel,
        modelRegistry: {
          async getApiKeyAndHeaders() {
            return { ok: true as const };
          },
        },
        sessionManager: {},
        ui: {},
      },
      reasoningModel,
      "sess",
      {
        async completeSimple() {
          throw new Error("completeSimple should not run without a token");
        },
      },
    );
    await assert.rejects(
      () => complete({ purpose: "block", blockNumber: 1, systemPrompt: "s", userPrompt: "u" }),
      /no API key for "openai-codex"/,
    );
  });

  it("does not send reasoning options for non-reasoning models", async () => {
    let options: { reasoning?: string; reasoningEffort?: string } | undefined;
    const complete = createCompleteFn(
      ctxWith({ role: "assistant", content: [{ type: "text", text: "no" }] }, (opts) => {
        options = opts as { reasoning?: string; reasoningEffort?: string };
      }),
      model,
      "sess",
    );
    await complete({ purpose: "block", blockNumber: 1, systemPrompt: "s", userPrompt: "u" });
    assert.equal(options?.reasoning, undefined);
    assert.equal(options?.reasoningEffort, undefined);
  });

  it("uses pi.getThinkingLevel when ctx.thinkingLevel is unset", async () => {
    const reasoningModel: PiModel = { ...model, reasoning: true };
    let options: { reasoning?: string } | undefined;
    const complete = createCompleteFn(
      ctxWith({ role: "assistant", content: [{ type: "text", text: "no" }] }, (opts) => {
        options = opts as { reasoning?: string };
      }),
      reasoningModel,
      "sess",
      { getThinkingLevel: () => "high" },
    );
    await complete({ purpose: "block", blockNumber: 1, systemPrompt: "s", userPrompt: "u" });
    assert.equal(options?.reasoning, "high");
  });

  it("honors an explicit maxTokens override", async () => {
    let options: { maxTokens?: number } | undefined;
    const complete = createCompleteFn(
      ctxWith({ role: "assistant", content: [{ type: "text", text: "no" }] }, (opts) => {
        options = opts as { maxTokens?: number };
      }),
      model,
      "sess",
    );
    await complete({
      purpose: "deliberation",
      round: 2,
      systemPrompt: "s",
      userPrompt: "u",
      maxTokens: 4096,
    });
    assert.equal(options?.maxTokens, 4096);
  });
});
