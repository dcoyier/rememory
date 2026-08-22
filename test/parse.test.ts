import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allBlocksSaidNo, parseBlockOutput, parseDeliberationNote } from "../src/parse.ts";

describe("parseBlockOutput", () => {
  it("treats no as no", () => {
    assert.deepEqual(parseBlockOutput("no", 1), { kind: "no", blockNumber: 1 });
    assert.deepEqual(parseBlockOutput("NO\n", 2), { kind: "no", blockNumber: 2 });
    assert.deepEqual(parseBlockOutput("  no  ", 3), { kind: "no", blockNumber: 3 });
  });

  it("reads yes plus body", () => {
    const got = parseBlockOutput("yes\nThe staging DB is required.", 1);
    assert.deepEqual(got, {
      kind: "yes",
      blockNumber: 1,
      text: "The staging DB is required.",
    });
  });

  it("treats yes with empty body as no", () => {
    assert.equal(parseBlockOutput("yes", 1).kind, "no");
  });

  it("accepts Yes: prefix", () => {
    const got = parseBlockOutput("Yes: prior approach used JWT in cookies.", 4);
    assert.equal(got.kind, "yes");
    if (got.kind === "yes") {
      assert.equal(got.text, "prior approach used JWT in cookies.");
    }
  });

  it("defaults unknown text to no", () => {
    assert.equal(parseBlockOutput("here is a summary of the block", 1).kind, "no");
  });

  it("ignores leading blank lines and a trailing period on yes", () => {
    const got = parseBlockOutput("\n\nYes.\nThe API key lives in the vault.", 1);
    assert.equal(got.kind, "yes");
    if (got.kind === "yes") {
      assert.equal(got.text, "The API key lives in the vault.");
    }
  });
});

describe("parseDeliberationNote", () => {
  it("drops empty and sentinel outputs", () => {
    assert.equal(parseDeliberationNote(""), null);
    assert.equal(parseDeliberationNote("no"), null);
    assert.equal(parseDeliberationNote("Produce no memory note."), null);
    assert.equal(parseDeliberationNote("nothing useful surfaced"), null);
  });

  it("keeps a real note", () => {
    const note = "Auth lives in .env.local; do not rebase shared branches.";
    assert.equal(parseDeliberationNote(note), note);
  });
});

describe("allBlocksSaidNo", () => {
  it("is true when every block abstains", () => {
    assert.equal(
      allBlocksSaidNo([
        { kind: "no", blockNumber: 1 },
        { kind: "no", blockNumber: 2 },
      ]),
      true,
    );
  });

  it("is false when any block contributes", () => {
    assert.equal(
      allBlocksSaidNo([
        { kind: "no", blockNumber: 1 },
        { kind: "yes", blockNumber: 2, text: "x" },
      ]),
      false,
    );
  });
});
