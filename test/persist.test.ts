import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { persistNote } from "../src/persist.ts";
import { CUSTOM_TYPE } from "../src/constants.ts";
import { formatMemoryNote } from "../src/serialize.ts";
import { sessionIdFromFile } from "../src/session.ts";
import type { PiExtensionAPI } from "../src/pi-types.ts";

describe("persistNote", () => {
  it("skips sendMessage when the snapshot already has the note", async () => {
    const sent: unknown[] = [];
    const pi = {
      sendMessage(message: unknown) {
        sent.push(message);
      },
    } as PiExtensionAPI;
    const body = "Use staging.";
    const result = await persistNote(pi, {
      messages: [
        { role: "user", content: "go" },
        { role: "custom", customType: CUSTOM_TYPE, content: formatMemoryNote(body) },
      ],
    }, body);
    assert.equal(result, undefined);
    assert.equal(sent.length, 0);
  });

  it("skips persist when the session is no longer current", async () => {
    const sent: unknown[] = [];
    const pi = {
      sendMessage(message: unknown) {
        sent.push(message);
      },
    } as PiExtensionAPI;
    const result = await persistNote(
      pi,
      { messages: [{ role: "user", content: "go" }] },
      "Use staging.",
      { stillCurrent: () => false },
    );
    assert.equal(result, undefined);
    assert.equal(sent.length, 0);
  });
});

describe("sessionIdFromFile", () => {
  it("reads the session header id", () => {
    const dir = mkdtempSync(join(tmpdir(), "hm-sid-"));
    try {
      const file = join(dir, "20240101_ignored.jsonl");
      writeFileSync(
        file,
        `${JSON.stringify({ type: "session", version: 3, id: "real-session-id" })}\n{"type":"message"}\n`,
      );
      assert.equal(sessionIdFromFile(file), "real-session-id");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
