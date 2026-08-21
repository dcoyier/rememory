import { INDEX_ENTRY_TYPE } from "./constants.ts";
import { estimateTokens } from "./fit.ts";
import type { PiExtensionAPI, PiExtensionContext } from "./pi-types.ts";
import { serializeMessages, type SerializedMessage } from "./serialize.ts";
import type { BlockStore } from "./store.ts";
import { ensureStore } from "./session.ts";

export interface CompactEvent {
  reason?: string;
  preparation?: {
    messagesToSummarize?: SerializedMessage[];
    turnPrefixMessages?: SerializedMessage[];
    firstKeptEntryId?: string;
  };
}

export interface PendingFreeze {
  reason: string;
  messages: SerializedMessage[];
  serialized: string;
  tokenEstimate: number;
  firstKeptEntryId?: string;
}

/** Snapshot the departing window in memory. Disk write happens on successful compact. */
export function prepareFreeze(
  event: CompactEvent,
  ctx: PiExtensionContext,
  store: BlockStore | null,
): { store: BlockStore; pending: PendingFreeze | null } {
  const next = ensureStore(ctx, store);
  const preparation = event.preparation ?? {};
  const messages = [
    ...(preparation.messagesToSummarize ?? []),
    ...(preparation.turnPrefixMessages ?? []),
  ];
  if (messages.length === 0) return { store: next, pending: null };

  const serialized = serializeMessages(messages);
  return {
    store: next,
    pending: {
      reason: event.reason ?? "threshold",
      messages,
      serialized,
      tokenEstimate: estimateTokens(serialized),
      firstKeptEntryId: preparation.firstKeptEntryId,
    },
  };
}

export function commitFreeze(
  pending: PendingFreeze,
  store: BlockStore,
  pi: PiExtensionAPI,
  breadcrumbWritten: boolean,
): { store: BlockStore; breadcrumbWritten: boolean } {
  store.append({
    reason: pending.reason,
    messages: pending.messages,
    serialized: pending.serialized,
    tokenEstimate: pending.tokenEstimate,
    firstKeptEntryId: pending.firstKeptEntryId,
  });

  if (!breadcrumbWritten) {
    pi.appendEntry(INDEX_ENTRY_TYPE, { sessionId: store.sessionId, dir: store.dir });
    breadcrumbWritten = true;
  }
  return { store, breadcrumbWritten };
}
