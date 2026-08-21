import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BLOCK_SYSTEM_PROMPT,
  buildBlockUserPrompt,
  DELIBERATION_SYSTEM_PROMPT,
} from "../src/prompts.ts";

describe("prompts", () => {
  it("keeps the agreed block-agent wording", () => {
    assert.ok(
      BLOCK_SYSTEM_PROMPT.includes(
        "would actually be useful to what the main agent is currently doing, not merely related to it",
      ),
    );
    assert.ok(
      BLOCK_SYSTEM_PROMPT.includes(
        "already adequately captured in the current context or the deliberation unless your block adds something truly useful",
      ),
    );
    assert.ok(BLOCK_SYSTEM_PROMPT.includes("very concise, idea-centered explanation"));
  });

  it("puts block number after the XML bodies so cache prefixes stay stable", () => {
    const user = buildBlockUserPrompt({
      historicalBlock: "H",
      currentContext: "C",
      deliberation: "D",
      blockNumber: 2,
      totalBlocks: 5,
    });
    const hist = user.indexOf("<HISTORICAL_BLOCK>");
    const current = user.indexOf("<CURRENT_AGENT_CONTEXT>");
    const delib = user.indexOf("<CURRENT_DELIBERATION>");
    const note = user.indexOf("block number 2 out of 5");
    assert.ok(hist < current && current < delib && delib < note);
  });

  it("keeps the two-round deliberation contract and round-2 grounding", () => {
    assert.ok(DELIBERATION_SYSTEM_PROMPT.includes("This system runs for exactly two rounds"));
    assert.ok(DELIBERATION_SYSTEM_PROMPT.includes("Aim for a maximum of 1,000 tokens"));
    assert.ok(DELIBERATION_SYSTEM_PROMPT.includes("If nothing useful surfaced, produce no memory note"));
    assert.ok(
      DELIBERATION_SYSTEM_PROMPT.includes(
        "Carefully note which historical block each contribution came from, and what the previous synthesis has already settled on.",
      ),
    );
  });
});
