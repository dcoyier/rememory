import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recallPlan, skipReason } from "../src/plan.ts";

describe("recallPlan", () => {
  it("skips with zero blocks", () => {
    assert.equal(recallPlan(0), "none");
  });

  it("uses the full two-round protocol for one or more blocks", () => {
    assert.equal(recallPlan(1), "full");
    assert.equal(recallPlan(2), "full");
    assert.equal(recallPlan(8), "full");
  });
});

describe("skipReason", () => {
  const base = {
    enabled: true,
    compacting: false,
    protocolRunning: false,
    hasModel: true,
  };

  it("skips compaction", () => {
    assert.equal(skipReason({ ...base, compacting: true }), "compacting");
  });

  it("skips when there is no model", () => {
    assert.equal(skipReason({ ...base, hasModel: false }), "no-model");
  });

  it("skips reentrancy and disabled", () => {
    assert.equal(skipReason({ ...base, protocolRunning: true }), "reentrancy");
    assert.equal(skipReason({ ...base, enabled: false }), "disabled");
  });

  it("runs otherwise", () => {
    assert.equal(skipReason(base), null);
  });
});
