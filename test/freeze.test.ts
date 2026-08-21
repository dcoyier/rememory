import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { commitFreeze, prepareFreeze } from "../src/freeze.ts";
import { BlockStore } from "../src/store.ts";
import type { PiExtensionAPI, PiExtensionContext } from "../src/pi-types.ts";

function ctxFor(dir: string, sessionId: string): PiExtensionContext {
  return {
    cwd: dir,
    modelRegistry: { async complete() { return { role: "assistant", content: [] }; } },
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionDir: () => dir,
      getHeader: () => ({ id: sessionId }),
    },
    ui: {},
  };
}

describe("prepareFreeze / commitFreeze", () => {
  it("does not write a block until commit", () => {
    const dir = mkdtempSync(join(tmpdir(), "hm-freeze-"));
    try {
      const store = new BlockStore(join(dir, "s1"), "s1");
      const prepared = prepareFreeze(
        {
          reason: "threshold",
          preparation: {
            messagesToSummarize: [{ role: "user", content: "old" }],
            turnPrefixMessages: [],
          },
        },
        ctxFor(dir, "s1"),
        store,
      );
      assert.ok(prepared.pending);
      assert.equal(prepared.store.blockCount, 0);

      const entries: unknown[] = [];
      const pi = { appendEntry(_t: string, data: unknown) { entries.push(data); } } as PiExtensionAPI;
      const committed = commitFreeze(prepared.pending!, prepared.store, pi, false);
      assert.equal(committed.store.blockCount, 1);
      assert.equal(committed.breadcrumbWritten, true);
      assert.equal(entries.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns no pending freeze when there are no messages", () => {
    const dir = mkdtempSync(join(tmpdir(), "hm-freeze-"));
    try {
      const store = new BlockStore(join(dir, "s1"), "s1");
      const prepared = prepareFreeze(
        { reason: "threshold", preparation: { messagesToSummarize: [] } },
        ctxFor(dir, "s1"),
        store,
      );
      assert.equal(prepared.pending, null);
      assert.equal(prepared.store.blockCount, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
