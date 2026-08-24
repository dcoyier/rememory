import { CUSTOM_TYPE } from "./constants.ts";
import type { PiExtensionAPI, PiMessage } from "./pi-types.ts";
import {
  formatMemoryNote,
  snapshotAlreadyHasNote,
  type SerializedMessage,
} from "./serialize.ts";

export function persistNote(
  pi: PiExtensionAPI,
  event: { messages?: PiMessage[] },
  noteBody: string,
  options?: {
    stillCurrent?: () => boolean;
    persistedBodies?: Set<string>;
    onPersistError?: (message: string) => void;
  },
): { messages: PiMessage[] } | undefined {
  if (options?.stillCurrent && !options.stillCurrent()) return undefined;

  const snapshot = (event.messages ?? []) as SerializedMessage[];
  if (snapshotAlreadyHasNote(snapshot, noteBody)) {
    options?.persistedBodies?.add(noteBody);
    return undefined;
  }

  const content = formatMemoryNote(noteBody);
  const details = { id: `note-${Date.now()}`, kind: CUSTOM_TYPE };
  const noteMessage: PiMessage = {
    role: "custom",
    customType: CUSTOM_TYPE,
    content,
    display: true,
    details,
    timestamp: Date.now(),
  };

  const alreadySent = options?.persistedBodies?.has(noteBody) === true;
  if (!alreadySent) {
    if (options?.stillCurrent && !options.stillCurrent()) return undefined;
    try {
      // context runs while the agent is streaming. sendMessage without deliverAs
      // then steers, which can start another model turn. nextTurn writes the note
      // into the session on the following user prompt; this call sees it via the
      // returned snapshot splice below.
      pi.sendMessage(
        {
          customType: CUSTOM_TYPE,
          content,
          display: true,
          details,
        },
        { triggerTurn: false, deliverAs: "nextTurn" },
      );
      options?.persistedBodies?.add(noteBody);
    } catch (error) {
      options?.onPersistError?.(error instanceof Error ? error.message : String(error));
    }
  }

  if (options?.stillCurrent && !options.stillCurrent()) return undefined;

  return { messages: [...(event.messages ?? []), noteMessage] };
}
