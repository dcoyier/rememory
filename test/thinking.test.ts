import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isReadableThinking, looksEncryptedThinking } from "../src/thinking.ts";

describe("looksEncryptedThinking", () => {
  it("detects Codex/OpenAI encrypted_content JSON", () => {
    const blob = JSON.stringify({
      id: "rs_123",
      type: "reasoning",
      encrypted_content: "gAAAAABencryptedpayload".repeat(8),
      summary: [],
    });
    assert.equal(looksEncryptedThinking(blob), true);
  });

  it("detects a long opaque base64 blob", () => {
    assert.equal(looksEncryptedThinking("A".repeat(240)), true);
  });

  it("keeps ordinary thinking prose", () => {
    assert.equal(looksEncryptedThinking("yes\nThe vault path is still required."), false);
  });
});

describe("isReadableThinking", () => {
  it("rejects redacted and signature-only blocks", () => {
    assert.equal(
      isReadableThinking({ type: "thinking", thinking: "", thinkingSignature: '{"encrypted_content":"x"}' }),
      false,
    );
    assert.equal(
      isReadableThinking({ type: "thinking", thinking: "[Reasoning redacted]", redacted: true }),
      false,
    );
  });

  it("accepts a Codex reasoning summary", () => {
    assert.equal(
      isReadableThinking({
        type: "thinking",
        thinking: "The user previously required the staging DB.",
        thinkingSignature: JSON.stringify({ type: "reasoning", encrypted_content: "cipher" }),
      }),
      true,
    );
  });
});
