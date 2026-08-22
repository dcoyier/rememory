import { STATUS_KEY } from "./constants.ts";
import { isAbort, messageOf } from "./errors.ts";
import { commitFreeze, prepareFreeze, type PendingFreeze } from "./freeze.ts";
import { createCompleteFn } from "./llm.ts";
import { persistNote } from "./persist.ts";
import { skipReason } from "./plan.ts";
import { runRecall } from "./protocol.ts";
import { serializeMessages, type SerializedMessage } from "./serialize.ts";
import { MAIN_AGENT_SYSTEM_APPEND } from "./prompts.ts";
import { inheritFromParent, openStore } from "./session.ts";
import type { BlockStore } from "./store.ts";
import type { PiExtensionAPI, PiExtensionContext } from "./pi-types.ts";
import { sessionIdOf } from "./pi-types.ts";

interface RuntimeState {
  enabled: boolean;
  compacting: boolean;
  protocolRunning: boolean;
  recallGeneration: number;
  store: BlockStore | null;
  pendingFreeze: PendingFreeze | null;
  breadcrumbWritten: boolean;
  persistedNotes: Set<string>;
  freshCompact: boolean;
}

export default function historicalMemory(pi: PiExtensionAPI): void {
  const state: RuntimeState = {
    enabled: true,
    compacting: false,
    protocolRunning: false,
    recallGeneration: 0,
    store: null,
    pendingFreeze: null,
    breadcrumbWritten: false,
    persistedNotes: new Set(),
    freshCompact: false,
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
      const store = state.store ?? openStore(ctx);
      state.store = store;
      ctx.ui.notify?.(
        `Historical memory: ${state.enabled ? "on" : "off"} · ${store.blockCount} blocks · ${store.dir}`,
        "info",
      );
    },
  });

  pi.on("session_start", (_event, ctx) => bindSession(ctx, state));
  pi.on("session_shutdown", () => invalidateSession(state));

  pi.on("before_agent_start", (event, ctx) => {
    if (!state.enabled) return;
    const store = state.store ?? openStore(ctx);
    state.store = store;
    if (store.blockCount === 0) return;
    const base = typeof event.systemPrompt === "string" ? event.systemPrompt : "";
    if (base.includes(MAIN_AGENT_SYSTEM_APPEND)) return;
    return { systemPrompt: base ? `${base}\n\n${MAIN_AGENT_SYSTEM_APPEND}` : MAIN_AGENT_SYSTEM_APPEND };
  });

  pi.on("session_before_compact", (event, ctx) => {
    state.compacting = true;
    try {
      const prepared = prepareFreeze(event, ctx, state.store);
      state.store = prepared.store;
      state.pendingFreeze = prepared.pending;
    } catch (error) {
      state.pendingFreeze = null;
      ctx.ui.notify?.(`Historical memory freeze failed: ${messageOf(error)}`, "error");
    }
  });

  pi.on("session_compact", (_event, ctx) => {
    try {
      if (state.pendingFreeze && state.store) {
        const committed = commitFreeze(
          state.pendingFreeze,
          state.store,
          pi,
          state.breadcrumbWritten,
        );
        state.store = committed.store;
        state.breadcrumbWritten = committed.breadcrumbWritten;
        state.freshCompact = true;
      }
    } catch (error) {
      ctx.ui.notify?.(`Historical memory freeze failed: ${messageOf(error)}`, "error");
    } finally {
      state.pendingFreeze = null;
      state.compacting = false;
    }
  });

  pi.on("session_compact_failed", () => {
    state.pendingFreeze = null;
    state.compacting = false;
  });

  pi.on("context", async (event, ctx) => {
    const skip = skipReason({
      enabled: state.enabled,
      compacting: state.compacting,
      protocolRunning: state.protocolRunning,
      hasModel: Boolean(ctx.model),
    });
    if (skip) return;

    const store = state.store ?? openStore(ctx);
    state.store = store;
    const blocks = store.loadAll();
    if (blocks.length === 0 || !ctx.model) return;

    const generation = state.recallGeneration;
    const afterCompact = state.freshCompact;
    state.freshCompact = false;
    state.protocolRunning = true;
    try {
      const messages = (event.messages ?? []) as SerializedMessage[];
      const result = await runRecall({
        blocks,
        currentContext: serializeMessages(messages),
        complete: createCompleteFn(ctx, ctx.model, sessionIdOf(ctx)),
        signal: ctx.signal,
        contextWindow: ctx.model.contextWindow,
        afterCompact,
        onStatus: (text) => {
          if (state.recallGeneration === generation) {
            ctx.ui.setStatus?.(STATUS_KEY, text);
          }
        },
      });
      if (!result.note) return;
      return persistNote(pi, event, result.note, {
        stillCurrent: () => state.recallGeneration === generation,
        persistedBodies: state.persistedNotes,
        onPersistError: (message) => {
          ctx.ui.notify?.(`Historical memory persist failed: ${message}`, "warning");
        },
      });
    } catch (error) {
      if (isAbort(error)) return;
      ctx.ui.notify?.(`Historical memory recall failed: ${messageOf(error)}`, "error");
    } finally {
      if (state.recallGeneration === generation) {
        state.protocolRunning = false;
        ctx.ui.setStatus?.(STATUS_KEY, undefined);
      }
    }
  });
}

function invalidateSession(state: RuntimeState): void {
  state.recallGeneration += 1;
  state.protocolRunning = false;
  state.compacting = false;
  state.pendingFreeze = null;
  state.persistedNotes.clear();
  state.freshCompact = false;
}

function bindSession(ctx: PiExtensionContext, state: RuntimeState): void {
  invalidateSession(state);
  state.breadcrumbWritten = false;
  try {
    state.store = openStore(ctx);
    inheritFromParent(ctx, state.store);
  } catch (error) {
    state.store = null;
    ctx.ui.notify?.(`Historical memory could not open store: ${messageOf(error)}`, "error");
  }
}
