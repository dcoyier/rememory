import { INDEX_ENTRY_TYPE } from "./constants.ts";
import { estimateTokens } from "./fit.ts";
import type { PiExtensionAPI, PiExtensionContext } from "./pi-types.ts";
import { serializeMessages, type SerializedMessage } from "./serialize.ts";
import type { BlockStore } from "./store.ts";
import { ensureStore } from "./session.ts";

export function freezeBlock(
  event: {
    reason?: string;
    preparation?: {
      messagesToSummarize?: SerializedMessage[];
      turnPrefixMessages?: SerializedMessage[];
      firstKeptEntryId?: string;
    };
  },
  ctx: PiExtensionContext,
  store: BlockStore | null,
  pi: PiExtensionAPI,
  breadcrumbWritten: boolean,
): { store: BlockStore; breadcrumbWritten: boolean } {
  const next = ensureStore(ctx, store);
  const preparation = event.preparation ?? {};
  const messages = [
    ...(preparation.messagesToSummarize ?? []),
    ...(preparation.turnPrefixMessages ?? []),
  ];
  if (messages.length === 0) return { store: next, breadcrumbWritten };

  const serialized = serializeMessages(messages);
  next.append({
    reason: event.reason ?? "threshold",
    messages,
    serialized,
    tokenEstimate: estimateTokens(serialized),
    firstKeptEntryId: preparation.firstKeptEntryId,
  });

  if (!breadcrumbWritten) {
    pi.appendEntry(INDEX_ENTRY_TYPE, { sessionId: next.sessionId, dir: next.dir });
    breadcrumbWritten = true;
  }
  return { store: next, breadcrumbWritten };
}
