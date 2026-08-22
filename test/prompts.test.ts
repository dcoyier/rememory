import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BLOCK_SYSTEM_PROMPT,
  buildBlockUserPrompt,
  DELIBERATION_SYSTEM_PROMPT,
  MAIN_AGENT_SYSTEM_APPEND,
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
    assert.ok(
      BLOCK_SYSTEM_PROMPT.includes(
        "Durable user preferences, standing instructions, and constraints are useful when they are missing from the current context",
      ),
    );
    assert.ok(BLOCK_SYSTEM_PROMPT.includes('echo "Memory: <question>"'));
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
    assert.ok(
      DELIBERATION_SYSTEM_PROMPT.includes(
        "the note may be substantially longer than 1,000 tokens",
      ),
    );
    assert.equal(DELIBERATION_SYSTEM_PROMPT.includes("Do not assemble a user profile"), false);
    assert.ok(DELIBERATION_SYSTEM_PROMPT.includes("If nothing useful surfaced, produce no memory note"));
    assert.ok(
      DELIBERATION_SYSTEM_PROMPT.includes(
        "Carefully note which historical block each contribution came from, and what the previous synthesis has already settled on.",
      ),
    );
    assert.ok(
      DELIBERATION_SYSTEM_PROMPT.includes(
        "including missing standing preferences and constraints, and excluding ones already in the current context",
      ),
    );
    assert.ok(DELIBERATION_SYSTEM_PROMPT.includes('echo "Memory: <question>"'));
    assert.ok(DELIBERATION_SYSTEM_PROMPT.includes("present in the most recent main agent tool call"));
    assert.ok(MAIN_AGENT_SYSTEM_APPEND.includes('echo "Memory: <question>"'));
  });
});
