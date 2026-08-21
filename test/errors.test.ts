import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAbort } from "../src/errors.ts";

describe("isAbort", () => {
  it("matches AbortError by name only", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    assert.equal(isAbort(abort), true);
    assert.equal(isAbort({ name: "AbortError" }), true);
  });

  it("does not treat a provider error whose message is aborted as user abort", () => {
    assert.equal(isAbort(new Error("aborted")), false);
    assert.equal(isAbort("aborted"), false);
  });
});
