import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { BlockStore } from "../src/store.ts";

describe("BlockStore", () => {
  it("appends blocks to disk and reloads them", () => {
    const dir = mkdtempSync(join(tmpdir(), "hm-store-"));
    try {
      const store = new BlockStore(join(dir, "sess-1"), "sess-1");
      assert.equal(store.blockCount, 0);
      store.append({
        reason: "threshold",
        messages: [{ role: "user", content: "hello" }],
        serialized: "[User]: hello",
        tokenEstimate: 4,
      });
      assert.equal(store.blockCount, 1);

      const reopened = new BlockStore(join(dir, "sess-1"), "sess-1");
      assert.equal(reopened.blockCount, 1);
      const block = reopened.load(1);
      assert.equal(block.serialized, "[User]: hello");
      assert.equal(block.messages[0]?.role, "user");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rebuilds the index from block files if index.json is corrupt", () => {
    const dir = mkdtempSync(join(tmpdir(), "hm-store-"));
    try {
      const store = new BlockStore(join(dir, "sess-1"), "sess-1");
      store.append({
        reason: "threshold",
        messages: [{ role: "user", content: "hello" }],
        serialized: "[User]: hello",
        tokenEstimate: 4,
      });
      writeFileSync(join(store.dir, "index.json"), "{not json");
      const reopened = new BlockStore(store.dir, "sess-1");
      assert.equal(reopened.blockCount, 1);
      assert.equal(reopened.load(1).serialized, "[User]: hello");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("copies an archive onto a forked session", () => {
    const dir = mkdtempSync(join(tmpdir(), "hm-fork-"));
    try {
      const parent = new BlockStore(join(dir, "parent"), "parent");
      parent.append({
        reason: "manual",
        messages: [{ role: "user", content: "old" }],
        serialized: "old",
        tokenEstimate: 1,
      });
      const child = new BlockStore(join(dir, "child"), "child");
      child.copyFrom(parent.dir);
      assert.equal(child.blockCount, 1);
      assert.equal(child.load(1).serialized, "old");
      assert.equal(child.sessionId, "child");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps an unreadable block slot so two entries still use the full plan", () => {
    const dir = mkdtempSync(join(tmpdir(), "hm-store-"));
    try {
      const store = new BlockStore(join(dir, "sess-1"), "sess-1");
      store.append({
        reason: "threshold",
        messages: [{ role: "user", content: "one" }],
        serialized: "one",
        tokenEstimate: 1,
      });
      store.append({
        reason: "threshold",
        messages: [{ role: "user", content: "two" }],
        serialized: "two",
        tokenEstimate: 1,
      });
      writeFileSync(join(store.dir, "blocks", "0002.json"), "{not json");
      const loaded = store.loadAll();
      assert.equal(loaded.length, 2);
      assert.equal(loaded[0]?.unreadable, undefined);
      assert.equal(loaded[1]?.unreadable, true);
      assert.equal(loaded[1]?.n, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
