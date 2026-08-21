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
): Promise<{ messages: PiMessage[] } | undefined> {
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
  } catch {
    // Persistence failed; still splice into this call so the main model sees the note.
  }

  const snapshot = (event.messages ?? []) as SerializedMessage[];
  if (snapshotAlreadyHasNote(snapshot, noteBody)) return undefined;
  return { messages: [...(event.messages ?? []), noteMessage] };
}
