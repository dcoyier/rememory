import { AFTER_COMPACT_NOTE_MAX_TOKENS } from "./constants.ts";
import { isAbort } from "./errors.ts";
import {
  allBlocksSaidNo,
  formatContributionForDeliberation,
  parseBlockOutput,
  parseDeliberationNote,
  type BlockContribution,
} from "./parse.ts";
import { recallPlan } from "./plan.ts";
import {
  BLOCK_SYSTEM_PROMPT,
  buildBlockUserPrompt,
  buildDeliberationUserPrompt,
  DELIBERATION_SYSTEM_PROMPT,
  formatBlockContributions,
} from "./prompts.ts";
import type { FrozenBlock } from "./store.ts";
import { appendFileSync } from "node:fs";

function debugRecall(event: string, data: Record<string, unknown>): void {
  const path = process.env.HISTORICAL_MEMORY_DEBUG;
  if (!path) return;
  try {
    appendFileSync(path, `${JSON.stringify({ t: new Date().toISOString(), event, ...data })}\n`);
  } catch {
    // ignore
  }
}

export interface LlmCall {
  purpose: "block" | "deliberation";
  blockNumber?: number;
  totalBlocks?: number;
  round?: 1 | 2;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export type CompleteFn = (call: LlmCall, signal?: AbortSignal) => Promise<string>;

export interface ProtocolResult {
  note: string | null;
  plan: ReturnType<typeof recallPlan>;
  round1: BlockContribution[];
  round2: BlockContribution[];
}

export async function runRecall(input: {
  blocks: FrozenBlock[];
  currentContext: string;
  complete: CompleteFn;
  signal?: AbortSignal;
  afterCompact?: boolean;
  onStatus?: (text: string) => void;
}): Promise<ProtocolResult> {
  const { blocks, currentContext, complete, signal, afterCompact, onStatus } = input;
  const totalBlocks = blocks.length;
  const plan = recallPlan(totalBlocks);
  const empty: ProtocolResult = {
    note: null,
    plan,
    round1: [],
    round2: [],
  };
  if (plan === "none") return empty;

  const runBlock = async (
    block: FrozenBlock,
    deliberation: string,
    round: 1 | 2,
  ): Promise<BlockContribution> => {
    if (block.unreadable) {
      return { kind: "no", blockNumber: block.n };
    }
    const userPrompt = buildBlockUserPrompt({
      historicalBlock: block.serialized,
      currentContext,
      deliberation,
      blockNumber: block.n,
      totalBlocks,
    });
    debugRecall("block-call", { blockNumber: block.n, promptChars: userPrompt.length });
    throwIfAborted(signal);
    try {
      const raw = await complete(
        {
          purpose: "block",
          blockNumber: block.n,
          totalBlocks,
          round,
          systemPrompt: BLOCK_SYSTEM_PROMPT,
          userPrompt,
          maxTokens:
            afterCompact && plan === "single" ? AFTER_COMPACT_NOTE_MAX_TOKENS : undefined,
        },
        signal,
      );
      throwIfAborted(signal);
      debugRecall("block-raw", { blockNumber: block.n, raw: raw.slice(0, 300) });
      return parseBlockOutput(raw, block.n);
    } catch (error) {
      if (isAbort(error)) throw error;
      debugRecall("block-error", {
        blockNumber: block.n,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
      return { kind: "no", blockNumber: block.n };
    }
  };

  const runBlocks = async (deliberation: string, round: 1 | 2): Promise<BlockContribution[]> => {
    onStatus?.(`memory r${round} ${totalBlocks} blocks`);
    return Promise.all(blocks.map((block) => runBlock(block, deliberation, round)));
  };

  if (plan === "single") {
    const round1 = await runBlocks("", 1);
    const only = round1[0];
    if (!only || only.kind === "no") {
      return { ...empty, round1 };
    }
    return { note: only.text, plan, round1, round2: [] };
  }

  const round1 = await runBlocks("", 1);
  if (allBlocksSaidNo(round1)) {
    return { ...empty, round1 };
  }

  onStatus?.("memory d1");
  debugRecall("deliberation-start", { round: 1, afterCompact: Boolean(afterCompact) });
  const d1 = await runDeliberation({
    complete,
    signal,
    currentContext,
    previousDeliberation: "",
    contributions: round1,
    round: 1,
    afterCompact,
  });

  const round2 = await runBlocks(d1 ?? "", 2);

  onStatus?.("memory d2");
  debugRecall("deliberation-start", { round: 2, afterCompact: Boolean(afterCompact) });
  const note = await runDeliberation({
    complete,
    signal,
    currentContext,
    previousDeliberation: d1 ?? "",
    contributions: round2,
    round: 2,
    afterCompact,
  });

  return { note, plan, round1, round2 };
}

async function runDeliberation(input: {
  complete: CompleteFn;
  signal?: AbortSignal;
  currentContext: string;
  previousDeliberation: string;
  contributions: BlockContribution[];
  round: 1 | 2;
  afterCompact?: boolean;
}): Promise<string | null> {
  const expandNote = input.round === 2 && input.afterCompact;
  const userPrompt = buildDeliberationUserPrompt({
    roundNumber: input.round,
    currentContext: input.currentContext,
    previousDeliberation: input.previousDeliberation,
    blockContributions: formatBlockContributions(
      input.contributions.map((c) => ({
        blockNumber: c.blockNumber,
        text: formatContributionForDeliberation(c),
      })),
    ),
    afterCompact: expandNote,
  });
  throwIfAborted(input.signal);
  try {
    const raw = await input.complete(
      {
        purpose: "deliberation",
        round: input.round,
        systemPrompt: DELIBERATION_SYSTEM_PROMPT,
        userPrompt,
        maxTokens: expandNote ? AFTER_COMPACT_NOTE_MAX_TOKENS : undefined,
      },
      input.signal,
    );
    throwIfAborted(input.signal);
    debugRecall("deliberation-raw", { round: input.round, raw: raw.slice(0, 300) });
    if (input.round === 1) {
      const trimmed = raw.trim();
      return trimmed ? trimmed : null;
    }
    return parseDeliberationNote(raw);
  } catch (error) {
    if (isAbort(error)) throw error;
    return null;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  }
}
