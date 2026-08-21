import { FIT_OUTPUT_RESERVE } from "./constants.ts";
import { promptFitsWindow } from "./fit.ts";
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

export interface LlmCall {
  purpose: "block" | "deliberation";
  blockNumber?: number;
  totalBlocks?: number;
  round?: 1 | 2;
  systemPrompt: string;
  userPrompt: string;
}

export type CompleteFn = (call: LlmCall, signal?: AbortSignal) => Promise<string>;

export interface ProtocolResult {
  note: string | null;
  plan: ReturnType<typeof recallPlan>;
  round1: BlockContribution[];
  round2: BlockContribution[];
  skippedBlocks: number[];
}

export async function runRecall(input: {
  blocks: FrozenBlock[];
  currentContext: string;
  complete: CompleteFn;
  signal?: AbortSignal;
  contextWindow?: number;
  onStatus?: (text: string) => void;
}): Promise<ProtocolResult> {
  const { blocks, currentContext, complete, signal, contextWindow, onStatus } = input;
  const totalBlocks = blocks.length;
  const plan = recallPlan(totalBlocks);
  const empty: ProtocolResult = {
    note: null,
    plan,
    round1: [],
    round2: [],
    skippedBlocks: [],
  };
  if (plan === "none") return empty;

  const skippedBlocks: number[] = [];

  const runBlock = async (
    block: FrozenBlock,
    deliberation: string,
    round: 1 | 2,
  ): Promise<BlockContribution> => {
    const userPrompt = buildBlockUserPrompt({
      historicalBlock: block.serialized,
      currentContext,
      deliberation,
      blockNumber: block.n,
      totalBlocks,
    });
    const fits = promptFitsWindow({
      systemPrompt: BLOCK_SYSTEM_PROMPT,
      userPrompt,
      contextWindow,
      outputReserve: FIT_OUTPUT_RESERVE,
    });
    if (!fits) {
      skippedBlocks.push(block.n);
      return { kind: "no", blockNumber: block.n };
    }
    throwIfAborted(signal);
    const raw = await complete(
      {
        purpose: "block",
        blockNumber: block.n,
        totalBlocks,
        round,
        systemPrompt: BLOCK_SYSTEM_PROMPT,
        userPrompt,
      },
      signal,
    );
    throwIfAborted(signal);
    return parseBlockOutput(raw, block.n);
  };

  const runBlocks = async (deliberation: string, round: 1 | 2): Promise<BlockContribution[]> => {
    onStatus?.(`memory r${round} ${totalBlocks} blocks`);
    return Promise.all(blocks.map((block) => runBlock(block, deliberation, round)));
  };

  if (plan === "single") {
    const round1 = await runBlocks("", 1);
    const only = round1[0];
    if (!only || only.kind === "no") {
      return { ...empty, round1, skippedBlocks };
    }
    return { note: only.text, plan, round1, round2: [], skippedBlocks };
  }

  const round1 = await runBlocks("", 1);
  if (allBlocksSaidNo(round1)) {
    return { ...empty, round1, skippedBlocks };
  }

  onStatus?.("memory d1");
  const d1 = await runDeliberation({
    complete,
    signal,
    currentContext,
    previousDeliberation: "",
    contributions: round1,
    round: 1,
    contextWindow,
  });

  const round2 = await runBlocks(d1 ?? "", 2);

  onStatus?.("memory d2");
  const note = await runDeliberation({
    complete,
    signal,
    currentContext,
    previousDeliberation: d1 ?? "",
    contributions: round2,
    round: 2,
    contextWindow,
  });

  return { note, plan, round1, round2, skippedBlocks };
}

async function runDeliberation(input: {
  complete: CompleteFn;
  signal?: AbortSignal;
  currentContext: string;
  previousDeliberation: string;
  contributions: BlockContribution[];
  round: 1 | 2;
  contextWindow?: number;
}): Promise<string | null> {
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
  });
  const fits = promptFitsWindow({
    systemPrompt: DELIBERATION_SYSTEM_PROMPT,
    userPrompt,
    contextWindow: input.contextWindow,
    outputReserve: FIT_OUTPUT_RESERVE,
  });
  if (!fits) return null;
  throwIfAborted(input.signal);
  const raw = await input.complete(
    {
      purpose: "deliberation",
      round: input.round,
      systemPrompt: DELIBERATION_SYSTEM_PROMPT,
      userPrompt,
    },
    input.signal,
  );
  throwIfAborted(input.signal);
  if (input.round === 1) {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  }
  return parseDeliberationNote(raw);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  }
}
