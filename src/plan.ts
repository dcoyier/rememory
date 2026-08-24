export type RecallPlan = "none" | "full";

export type RecallSkipReason = "disabled" | "compacting" | "reentrancy" | "no-model";

export function recallPlan(blockCount: number): RecallPlan {
  if (blockCount <= 0) return "none";
  return "full";
}

export function skipReason(input: {
  enabled: boolean;
  compacting: boolean;
  protocolRunning: boolean;
  hasModel: boolean;
}): RecallSkipReason | null {
  if (!input.enabled) return "disabled";
  if (input.compacting) return "compacting";
  if (input.protocolRunning) return "reentrancy";
  if (!input.hasModel) return "no-model";
  return null;
}
