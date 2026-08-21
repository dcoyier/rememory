import { CUSTOM_TYPE } from "./constants.ts";
import type { PiExtensionAPI, PiMessage } from "./pi-types.ts";
import {
  formatMemoryNote,
  snapshotAlreadyHasNote,
  type SerializedMessage,
} from "./serialize.ts";

export async function persistNote(
  pi: PiExtensionAPI,
  event: { messages?: PiMessage[] },
  noteBody: string,
  options?: {
    stillCurrent?: () => boolean;
    onPersistError?: (message: string) => void;
  },
): Promise<{ messages: PiMessage[] } | undefined> {
  if (options?.stillCurrent && !options.stillCurrent()) return undefined;

  const snapshot = (event.messages ?? []) as SerializedMessage[];
  if (snapshotAlreadyHasNote(snapshot, noteBody)) return undefined;

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

  if (options?.stillCurrent && !options.stillCurrent()) return undefined;

  try {
    await pi.sendMessage(
      {
        customType: CUSTOM_TYPE,
        content,
        display: true,
        details,
      },
      { triggerTurn: false },
    );
  } catch (error) {
    options?.onPersistError?.(error instanceof Error ? error.message : String(error));
  }

  if (options?.stillCurrent && !options.stillCurrent()) return undefined;

  return { messages: [...(event.messages ?? []), noteMessage] };
}
