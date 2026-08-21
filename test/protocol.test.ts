import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LlmCall } from "../src/protocol.ts";
import { runRecall } from "../src/protocol.ts";
import type { FrozenBlock } from "../src/store.ts";

function block(n: number, text: string): FrozenBlock {
  return {
    n,
    createdAt: "2026-01-01T00:00:00.000Z",
    reason: "threshold",
    messages: [{ role: "user", content: text }],
    serialized: text,
  };
}

function scriptedComplete(script: (call: LlmCall) => string) {
  const calls: LlmCall[] = [];
  const complete = async (call: LlmCall) => {
    calls.push(call);
    return script(call);
  };
  return { calls, complete };
}

describe("runRecall", () => {
  it("does nothing with zero blocks", async () => {
    const { calls, complete } = scriptedComplete(() => {
      throw new Error("should not be called");
    });
    const result = await runRecall({
      blocks: [],
      currentContext: "now",
      complete,
    });
    assert.equal(result.plan, "none");
    assert.equal(result.note, null);
    assert.equal(calls.length, 0);
  });

  it("runs one block call and uses its yes text as the note", async () => {
    const { calls, complete } = scriptedComplete((call) => {
      assert.equal(call.purpose, "block");
      return "yes\nUse the staging database.";
    });
    const result = await runRecall({
      blocks: [block(1, "old db talk")],
      currentContext: "debugging prod",
      complete,
    });
    assert.equal(result.plan, "single");
    assert.equal(result.note, "Use the staging database.");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.purpose, "block");
  });

  it("emits nothing when the only block says no", async () => {
    const { complete } = scriptedComplete(() => "no");
    const result = await runRecall({
      blocks: [block(1, "old")],
      currentContext: "now",
      complete,
    });
    assert.equal(result.note, null);
  });

  it("skips deliberation when every block says no in round 1", async () => {
    const { calls, complete } = scriptedComplete(() => "no");
    const result = await runRecall({
      blocks: [block(1, "a"), block(2, "b")],
      currentContext: "now",
      complete,
    });
    assert.equal(result.plan, "full");
    assert.equal(result.note, null);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((c) => c.purpose === "block" && c.round === 1));
  });

  it("runs two parallel rounds plus two deliberations when blocks contribute", async () => {
    const { calls, complete } = scriptedComplete((call) => {
      if (call.purpose === "block" && call.round === 1) {
        return call.blockNumber === 1 ? "yes\nConstraint A" : "no";
      }
      if (call.purpose === "deliberation" && call.round === 1) {
        return "A may interact with later work";
      }
      if (call.purpose === "block" && call.round === 2) {
        return call.blockNumber === 2 ? "yes\nLater reversal of A" : "no";
      }
      return "Constraint A was later reversed.";
    });
    const result = await runRecall({
      blocks: [block(1, "a"), block(2, "b")],
      currentContext: "now",
      complete,
    });
    assert.equal(result.note, "Constraint A was later reversed.");
    assert.equal(calls.filter((c) => c.purpose === "block" && c.round === 1).length, 2);
    assert.equal(calls.filter((c) => c.purpose === "block" && c.round === 2).length, 2);
    assert.equal(calls.filter((c) => c.purpose === "deliberation").length, 2);
    // Round 2 still asked the block that said no in round 1.
    assert.ok(calls.some((c) => c.purpose === "block" && c.round === 2 && c.blockNumber === 1));
  });

  it("runs block calls in parallel within a round", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const complete = async (call: LlmCall) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      if (call.purpose === "block") return "no";
      return "no";
    };
    await runRecall({
      blocks: [block(1, "a"), block(2, "b"), block(3, "c")],
      currentContext: "now",
      complete,
    });
    assert.ok(maxInFlight >= 3);
  });

  it("treats a thrown block call as no without failing the round", async () => {
    const { complete } = scriptedComplete((call) => {
      if (call.purpose === "block" && call.blockNumber === 1) throw new Error("boom");
      if (call.purpose === "block") return "yes\nFrom block 2";
      if (call.purpose === "deliberation" && call.round === 1) return "block 2 had a signal";
      return "From block 2";
    });
    const result = await runRecall({
      blocks: [block(1, "a"), block(2, "b")],
      currentContext: "now",
      complete,
    });
    assert.equal(result.round1[0]?.kind, "no");
    assert.equal(result.round1[1]?.kind, "yes");
    assert.equal(result.note, "From block 2");
  });

  it("skips a block that cannot fit the model window instead of truncating", async () => {
    const huge = block(1, "x".repeat(10_000));
    const { calls, complete } = scriptedComplete(() => {
      throw new Error("must not call");
    });
    const result = await runRecall({
      blocks: [huge],
      currentContext: "now",
      complete,
      contextWindow: 100,
    });
    assert.equal(result.note, null);
    assert.deepEqual(result.skippedBlocks, [1]);
    assert.equal(calls.length, 0);
  });

  it("treats an unreadable block as no without collapsing to the single-block plan", async () => {
    const { calls, complete } = scriptedComplete((call) => {
      if (call.purpose === "block") return "yes\nFrom the readable block";
      if (call.purpose === "deliberation" && call.round === 1) return "readable block had a signal";
      return "From the readable block";
    });
    const result = await runRecall({
      blocks: [block(1, "ok"), { ...block(2, ""), serialized: "", unreadable: true }],
      currentContext: "now",
      complete,
    });
    assert.equal(result.plan, "full");
    assert.equal(result.round1[1]?.kind, "no");
    assert.equal(result.note, "From the readable block");
    assert.equal(calls.filter((c) => c.purpose === "block" && c.blockNumber === 2).length, 0);
    assert.ok(calls.some((c) => c.purpose === "deliberation"));
  });
});
