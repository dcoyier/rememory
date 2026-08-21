import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCompleteFn } from "../src/llm.ts";
import type { PiAssistantMessage, PiExtensionContext, PiModel } from "../src/pi-types.ts";

const model: PiModel = { id: "m", provider: "p", contextWindow: 100_000 };

function ctxWith(response: PiAssistantMessage): PiExtensionContext {
  return {
    cwd: "/tmp",
    model,
    modelRegistry: {
      async complete() {
        return response;
      },
    },
    sessionManager: {},
    ui: {},
  };
}

describe("createCompleteFn", () => {
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
});
