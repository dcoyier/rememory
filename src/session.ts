import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PiExtensionContext } from "./pi-types.ts";
import { sessionDirOf, sessionIdOf } from "./pi-types.ts";
import { BlockStore, storeDirForSession } from "./store.ts";

export function openStore(ctx: PiExtensionContext): BlockStore {
  const sessionId = sessionIdOf(ctx);
  const sessionDir = sessionDirOf(ctx);
  if (!sessionDir) {
    throw new Error("historical-memory: session directory is unavailable");
  }
  return new BlockStore(storeDirForSession(sessionDir, sessionId), sessionId);
}

export function ensureStore(
  ctx: PiExtensionContext,
  store: BlockStore | null,
): BlockStore {
  if (store && store.sessionId === sessionIdOf(ctx)) return store;
  return openStore(ctx);
}

export function inheritFromParent(ctx: PiExtensionContext, store: BlockStore): void {
  if (store.blockCount > 0) return;
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

export function sessionIdFromFile(sessionFile: string): string | undefined {
  try {
    const first = readFileSync(sessionFile, "utf8").split(/\r?\n/, 1)[0];
    if (first) {
      const header = JSON.parse(first) as { type?: string; id?: string };
      if (header.type === "session" && typeof header.id === "string") return header.id;
    }
  } catch {
    // Fall through to filename parsing.
  }
  const base = sessionFile.split(/[/\\]/).pop() ?? "";
  const stem = base.replace(/\.jsonl$/i, "");
  const separator = stem.lastIndexOf("_");
  if (separator >= 0) {
    const id = stem.slice(separator + 1);
    if (id.length >= 8) return id;
  }
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(stem) || /^[0-9a-f-]{8,}$/i.test(stem)) return stem;
  return undefined;
}
