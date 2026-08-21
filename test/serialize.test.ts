import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CUSTOM_TYPE } from "../src/constants.ts";
import {
  formatMemoryNote,
  serializeMessages,
  snapshotAlreadyHasNote,
} from "../src/serialize.ts";

describe("serializeMessages", () => {
  it("does not truncate tool results", () => {
    const long = "x".repeat(5000);
    const text = serializeMessages([
      { role: "toolResult", toolName: "bash", content: [{ type: "text", text: long }] },
    ]);
    assert.ok(text.includes(long));
    assert.equal(text.includes("truncated"), false);
  });

  it("replaces images with placeholders", () => {
    const text = serializeMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "see this" },
          { type: "image", mimeType: "image/png", data: "aaaa" },
        ],
      },
    ]);
    assert.ok(text.includes("see this"));
    assert.ok(text.includes("[image omitted: image/png]"));
    assert.equal(text.includes("aaaa"), false);
  });

  it("serializes string assistant content", () => {
    const text = serializeMessages([{ role: "assistant", content: "hello there" }]);
    assert.equal(text, "[Assistant]: hello there");
  });

  it("labels prior memory notes", () => {
    const text = serializeMessages([
      {
        role: "custom",
        customType: CUSTOM_TYPE,
        content: formatMemoryNote("use the staging db"),
      },
    ]);
    assert.ok(text.includes("[Memory note]"));
    assert.ok(text.includes("use the staging db"));
  });
});

describe("snapshotAlreadyHasNote", () => {
  it("detects a note already in the snapshot", () => {
    const body = "Auth is in .env.local";
    const messages = [
      { role: "user", content: "hi" },
      { role: "custom", customType: CUSTOM_TYPE, content: formatMemoryNote(body) },
    ];
    assert.equal(snapshotAlreadyHasNote(messages, body), true);
    assert.equal(snapshotAlreadyHasNote(messages, "other"), false);
    assert.equal(snapshotAlreadyHasNote([{ role: "user", content: "hi" }], body), false);
  });

  it("does not treat a substring overlap as the same note", () => {
    const messages = [
      {
        role: "custom",
        customType: CUSTOM_TYPE,
        content: formatMemoryNote("Auth is in .env.local"),
      },
    ];
    assert.equal(snapshotAlreadyHasNote(messages, "Auth"), false);
    assert.equal(snapshotAlreadyHasNote(messages, "Auth is in .env.local"), true);
  });
});
