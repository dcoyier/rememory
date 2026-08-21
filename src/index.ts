import { dirname, join } from "node:path";
import {
  CUSTOM_TYPE,
  INDEX_ENTRY_TYPE,
  STATUS_KEY,
} from "./constants.ts";
import { estimateTokens } from "./fit.ts";
import { createCompleteFn } from "./llm.ts";
import { skipReason } from "./plan.ts";
import { runRecall } from "./protocol.ts";
import {
  formatMemoryNote,
  serializeMessages,
  snapshotAlreadyHasNote,
  type SerializedMessage,
} from "./serialize.ts";
import { BlockStore, storeDirForSession } from "./store.ts";
import type { PiExtensionAPI, PiExtensionContext, PiMessage } from "./pi-types.ts";
import { sessionDirOf, sessionIdOf } from "./pi-types.ts";

interface RuntimeState {
  enabled: boolean;
  compacting: boolean;
  treeSummarizing: boolean;
  protocolRunning: boolean;
  store: BlockStore | null;
  breadcrumbWritten: boolean;
}

export default function historicalMemory(pi: PiExtensionAPI): void {
  const state: RuntimeState = {
    enabled: true,
    compacting: false,
    treeSummarizing: false,
    protocolRunning: false,
    store: null,
    breadcrumbWritten: false,
  };

  pi.registerCommand("memory", {
    description: "Show historical-memory status (on|off to toggle)",
    handler: (args, ctx) => {
      const cmd = args.trim().toLowerCase();
      if (cmd === "off") {
        state.enabled = false;
        ctx.ui.notify?.("Historical memory off", "info");
        return;
      }
      if (cmd === "on") {
        state.enabled = true;
        ctx.ui.notify?.("Historical memory on", "info");
        return;
      }
      const store = ensureStore(ctx, state);
      const dir = store?.dir ?? "(none)";
      ctx.ui.notify?.(
        `Historical memory: ${state.enabled ? "on" : "off"} · ${store?.blockCount ?? 0} blocks · ${dir}`,
        "info",
      );
    },
  });

  pi.on("session_start", (_event, ctx) => {
    state.store = openStore(ctx);
    maybeInheritFromParent(ctx, state.store);
  });

  pi.on("session_switch", (_event, ctx) => {
    state.store = openStore(ctx);
    maybeInheritFromParent(ctx, state.store);
    state.protocolRunning = false;
    state.compacting = false;
    state.treeSummarizing = false;
  });

  pi.on("session_before_compact", (event, ctx) => {
    state.compacting = true;
    try {
      freezeBlock(event, ctx, state, pi);
    } catch (error) {
      ctx.ui.notify?.(`Historical memory freeze failed: ${messageOf(error)}`, "error");
    }
  });

  pi.on("session_compact", () => {
    state.compacting = false;
  });

  pi.on("session_compact_failed", () => {
    state.compacting = false;
  });

  pi.on("session_before_tree", () => {
    state.treeSummarizing = true;
  });

  pi.on("session_tree", () => {
    state.treeSummarizing = false;
  });

  pi.on("context", async (event, ctx) => {
    const skip = skipReason({
      enabled: state.enabled,
      compacting: state.compacting,
      treeSummarizing: state.treeSummarizing,
      protocolRunning: state.protocolRunning,
      blockCount: state.store?.blockCount ?? 0,
      hasModel: Boolean(ctx.model),
    });
    if (skip) return;

    const store = state.store ?? openStore(ctx);
    if (!store || store.blockCount === 0 || !ctx.model) return;

    state.protocolRunning = true;
    state.store = store;
    try {
      const messages = (event.messages ?? []) as SerializedMessage[];
      const currentContext = serializeMessages(messages);
      const result = await runRecall({
        blocks: store.loadAll(),
        currentContext,
        complete: createCompleteFn(ctx, ctx.model, sessionIdOf(ctx)),
        signal: ctx.signal,
        contextWindow: ctx.model.contextWindow,
        onStatus: (text) => ctx.ui.setStatus?.(STATUS_KEY, text),
      });

      if (!result.note) return;
      return await persistNote(pi, event, result.note);
    } catch (error) {
      if (isAbort(error)) return;
      ctx.ui.notify?.(`Historical memory recall failed: ${messageOf(error)}`, "warning");
      return;
    } finally {
      state.protocolRunning = false;
      ctx.ui.setStatus?.(STATUS_KEY, undefined);
    }
  });
}

function freezeBlock(
  event: {
    reason?: string;
    preparation?: {
      messagesToSummarize?: SerializedMessage[];
      turnPrefixMessages?: SerializedMessage[];
      firstKeptEntryId?: string;
    };
  },
  ctx: PiExtensionContext,
  state: RuntimeState,
  pi: PiExtensionAPI,
): void {
  const store = ensureStore(ctx, state);
  if (!store) return;

  const preparation = event.preparation ?? {};
  const messages = [
    ...(preparation.messagesToSummarize ?? []),
    ...(preparation.turnPrefixMessages ?? []),
  ];
  if (messages.length === 0) return;

  const serialized = serializeMessages(messages);
  store.append({
    reason: event.reason ?? "threshold",
    messages,
    serialized,
    tokenEstimate: estimateTokens(serialized),
    firstKeptEntryId: preparation.firstKeptEntryId,
  });

  if (!state.breadcrumbWritten) {
    pi.appendEntry(INDEX_ENTRY_TYPE, { sessionId: store.sessionId, dir: store.dir });
    state.breadcrumbWritten = true;
  }
}

async function persistNote(
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

function openStore(ctx: PiExtensionContext): BlockStore | null {
  const sessionId = sessionIdOf(ctx);
  const sessionDir = sessionDirOf(ctx) ?? join(ctx.cwd, ".pi", "sessions");
  return new BlockStore(storeDirForSession(sessionDir, sessionId), sessionId);
}

function ensureStore(ctx: PiExtensionContext, state: RuntimeState): BlockStore | null {
  if (state.store && state.store.sessionId === sessionIdOf(ctx)) return state.store;
  state.store = openStore(ctx);
  return state.store;
}

function maybeInheritFromParent(ctx: PiExtensionContext, store: BlockStore | null): void {
  if (!store || store.blockCount > 0) return;
  const parentSession = ctx.sessionManager.getHeader?.()?.parentSession;
  if (!parentSession) return;
  const parentId = sessionIdFromFile(parentSession);
  const parentDir = dirname(parentSession);
  if (!parentId) return;
  try {
    store.copyFrom(storeDirForSession(parentDir, parentId));
  } catch {
    // Parent archive is optional.
  }
}

function sessionIdFromFile(sessionFile: string): string | undefined {
  const base = sessionFile.split(/[/\\]/).pop() ?? "";
  const match = base.match(/_([0-9a-f-]{8,})\.jsonl$/i) || base.match(/^([0-9a-f-]{8,})/i);
  return match?.[1];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")
  );
}
