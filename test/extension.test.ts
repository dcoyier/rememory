import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import historicalMemory from "../src/index.ts";
import { CUSTOM_TYPE } from "../src/constants.ts";
import type { PiAssistantMessage, PiExtensionAPI, PiExtensionContext } from "../src/pi-types.ts";

type Handler = (event: unknown, ctx: PiExtensionContext) => unknown;

function fakePi() {
  const handlers = new Map<string, Handler[]>();
  const sent: unknown[] = [];
  const entries: unknown[] = [];
  const pi: PiExtensionAPI = {
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler as Handler);
      handlers.set(event, list);
    },
    sendMessage(message, options) {
      sent.push({ message, options });
    },
    appendEntry(customType, data) {
      entries.push({ customType, data });
    },
    registerCommand() {},
  };
  return { pi, handlers, sent, entries };
}

function ctx(overrides: Partial<PiExtensionContext> & { sessionDir: string; sessionId: string }): PiExtensionContext {
  return {
    cwd: overrides.sessionDir,
    model: overrides.model ?? {
      id: "test-model",
      provider: "test",
      contextWindow: 200_000,
    },
    modelRegistry: overrides.modelRegistry ?? {
      async complete(): Promise<PiAssistantMessage> {
        return { role: "assistant", content: [{ type: "text", text: "no" }] };
      },
    },
    sessionManager: {
      getSessionId: () => overrides.sessionId,
      getSessionDir: () => overrides.sessionDir,
      getHeader: () => ({ id: overrides.sessionId }),
    },
    ui: {
      setStatus() {},
      notify() {},
    },
    signal: overrides.signal,
  };
}

describe("extension wiring", () => {
  it("does not call the model from context when there are no blocks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hm-ext-"));
    try {
      let completeCalls = 0;
      const { pi, handlers } = fakePi();
      historicalMemory(pi);
      const c = ctx({
        sessionDir: dir,
        sessionId: "s1",
        modelRegistry: {
          async complete() {
            completeCalls += 1;
            return { role: "assistant", content: [{ type: "text", text: "no" }] };
          },
        },
      });
      await handlers.get("session_start")?.[0]?.({}, c);
      const result = await handlers.get("context")?.[0]?.({ messages: [{ role: "user", content: "hi" }] }, c);
      assert.equal(result, undefined);
      assert.equal(completeCalls, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("freezes compacting messages to disk and skips recall while compacting", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hm-ext-"));
    try {
      let completeCalls = 0;
      const { pi, handlers, entries } = fakePi();
      historicalMemory(pi);
      const c = ctx({
        sessionDir: dir,
        sessionId: "s2",
        modelRegistry: {
          async complete() {
            completeCalls += 1;
            return { role: "assistant", content: [{ type: "text", text: "no" }] };
          },
        },
      });
      await handlers.get("session_start")?.[0]?.({}, c);
      await handlers.get("session_before_compact")?.[0]?.(
        {
          reason: "threshold",
          preparation: {
            messagesToSummarize: [{ role: "user", content: "ancient history" }],
            turnPrefixMessages: [],
            firstKeptEntryId: "abc",
          },
        },
        c,
      );
      assert.ok(entries.length >= 1);

      const during = await handlers.get("context")?.[0]?.({ messages: [{ role: "user", content: "now" }] }, c);
      assert.equal(during, undefined);
      assert.equal(completeCalls, 0);

      await handlers.get("session_compact")?.[0]?.({}, c);
      completeCalls = 0;
      await handlers.get("context")?.[0]?.({ messages: [{ role: "user", content: "now" }] }, c);
      assert.ok(completeCalls >= 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appends a note as an ordinary custom message, not steer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hm-ext-"));
    try {
      const { pi, handlers, sent } = fakePi();
      historicalMemory(pi);
      const c = ctx({
        sessionDir: dir,
        sessionId: "s3",
        modelRegistry: {
          async complete() {
            return {
              role: "assistant",
              content: [{ type: "text", text: "yes\nUse staging." }],
            };
          },
        },
      });
      await handlers.get("session_start")?.[0]?.({}, c);
      await handlers.get("session_before_compact")?.[0]?.(
        {
          reason: "manual",
          preparation: { messagesToSummarize: [{ role: "user", content: "old" }] },
        },
        c,
      );
      await handlers.get("session_compact")?.[0]?.({}, c);

      const result = (await handlers.get("context")?.[0]?.(
        { messages: [{ role: "user", content: "continue" }] },
        c,
      )) as { messages: Array<{ customType?: string }> } | undefined;

      assert.equal(sent.length, 1);
      const payload = sent[0] as {
        message: { customType: string };
        options: { triggerTurn: boolean; deliverAs?: string };
      };
      assert.equal(payload.message.customType, CUSTOM_TYPE);
      assert.equal(payload.options.triggerTurn, false);
      assert.equal(payload.options.deliverAs, undefined);
      assert.equal(result?.messages.at(-1)?.customType, CUSTOM_TYPE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
