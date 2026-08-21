export type RecallPlan = "none" | "single" | "full";

export type RecallSkipReason =
  | "disabled"
  | "compacting"
  | "tree-summarizing"
  | "reentrancy"
  | "no-blocks"
  | "no-model";

export function recallPlan(blockCount: number): RecallPlan {
  if (blockCount <= 0) return "none";
  if (blockCount === 1) return "single";
  return "full";
}

export function skipReason(input: {
  enabled: boolean;
  compacting: boolean;
  treeSummarizing: boolean;
  protocolRunning: boolean;
  blockCount: number;
  hasModel: boolean;
}): RecallSkipReason | null {
  if (!input.enabled) return "disabled";
  if (input.compacting) return "compacting";
  if (input.treeSummarizing) return "tree-summarizing";
  if (input.protocolRunning) return "reentrancy";
  if (input.blockCount <= 0) return "no-blocks";
  if (!input.hasModel) return "no-model";
  return null;
}
