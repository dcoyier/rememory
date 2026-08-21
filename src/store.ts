import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync, cpSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { STORE_DIR_NAME } from "./constants.ts";
import type { SerializedMessage } from "./serialize.ts";

export type CompactReason = "manual" | "threshold" | "overflow" | string;

export interface BlockMeta {
  n: number;
  file: string;
  createdAt: string;
  reason: CompactReason;
  messageCount: number;
  tokenEstimate: number;
  firstKeptEntryId?: string;
}

export interface FrozenBlock {
  n: number;
  createdAt: string;
  reason: CompactReason;
  firstKeptEntryId?: string;
  messages: SerializedMessage[];
  serialized: string;
}

export interface StoreIndex {
  version: 1;
  sessionId: string;
  blocks: BlockMeta[];
}

const INDEX_NAME = "index.json";
const BLOCKS_DIR = "blocks";

function pad(n: number): string {
  return String(n).padStart(4, "0");
}

function atomicWrite(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, contents, "utf8");
  renameSync(tmp, file);
}

export function storeDirForSession(sessionDir: string, sessionId: string): string {
  return join(sessionDir, STORE_DIR_NAME, sessionId);
}

export class BlockStore {
  readonly dir: string;
  readonly sessionId: string;
  private index: StoreIndex;

  constructor(dir: string, sessionId: string) {
    this.dir = dir;
    this.sessionId = sessionId;
    this.index = loadIndex(dir, sessionId);
  }

  get blockCount(): number {
    return this.index.blocks.length;
  }

  loadAll(): FrozenBlock[] {
    const blocks: FrozenBlock[] = [];
    for (const meta of this.index.blocks) {
      try {
        blocks.push(this.load(meta.n));
      } catch {
        // Skip unreadable files; recall should not fail the main agent.
      }
    }
    return blocks;
  }

  load(n: number): FrozenBlock {
    const meta = this.index.blocks.find((b) => b.n === n);
    if (!meta) throw new Error(`No historical block ${n}`);
    const raw = JSON.parse(readFileSync(join(this.dir, meta.file), "utf8")) as {
      n: number;
      createdAt: string;
      reason: CompactReason;
      firstKeptEntryId?: string;
      messages: SerializedMessage[];
      serialized: string;
    };
    return raw;
  }

  append(input: {
    reason: CompactReason;
    messages: SerializedMessage[];
    serialized: string;
    tokenEstimate: number;
    firstKeptEntryId?: string;
  }): FrozenBlock {
    const n = this.index.blocks.length + 1;
    const createdAt = new Date().toISOString();
    const file = join(BLOCKS_DIR, `${pad(n)}.json`);
    const block: FrozenBlock = {
      n,
      createdAt,
      reason: input.reason,
      firstKeptEntryId: input.firstKeptEntryId,
      messages: input.messages,
      serialized: input.serialized,
    };
    atomicWrite(join(this.dir, file), JSON.stringify(block));
    this.index.blocks.push({
      n,
      file,
      createdAt,
      reason: input.reason,
      messageCount: input.messages.length,
      tokenEstimate: input.tokenEstimate,
      firstKeptEntryId: input.firstKeptEntryId,
    });
    this.persistIndex();
    return block;
  }

  copyFrom(sourceDir: string): void {
    if (!existsSync(sourceDir)) return;
    if (sourceDir === this.dir) return;
    if (existsSync(this.dir)) rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(dirname(this.dir), { recursive: true });
    cpSync(sourceDir, this.dir, { recursive: true });
    this.index = loadIndex(this.dir, this.sessionId);
    this.index.sessionId = this.sessionId;
    this.persistIndex();
  }

  private persistIndex(): void {
    atomicWrite(join(this.dir, INDEX_NAME), JSON.stringify(this.index, null, 2));
  }
}

function loadIndex(dir: string, sessionId: string): StoreIndex {
  const path = join(dir, INDEX_NAME);
  if (!existsSync(path)) {
    return rebuildIndexFromFiles(dir, sessionId) ?? { version: 1, sessionId, blocks: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as StoreIndex;
    if (parsed.version !== 1 || !Array.isArray(parsed.blocks)) {
      return rebuildIndexFromFiles(dir, sessionId) ?? { version: 1, sessionId, blocks: [] };
    }
    return { ...parsed, sessionId: parsed.sessionId || sessionId };
  } catch {
    return rebuildIndexFromFiles(dir, sessionId) ?? { version: 1, sessionId, blocks: [] };
  }
}

function rebuildIndexFromFiles(dir: string, sessionId: string): StoreIndex | null {
  const blocksDir = join(dir, BLOCKS_DIR);
  if (!existsSync(blocksDir)) return null;
  const files = readdirSync(blocksDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (files.length === 0) return null;
  const blocks: BlockMeta[] = [];
  for (const name of files) {
    try {
      const raw = JSON.parse(readFileSync(join(blocksDir, name), "utf8")) as FrozenBlock;
      if (typeof raw.n !== "number") continue;
      blocks.push({
        n: raw.n,
        file: join(BLOCKS_DIR, name),
        createdAt: raw.createdAt,
        reason: raw.reason,
        messageCount: raw.messages?.length ?? 0,
        tokenEstimate: 0,
        firstKeptEntryId: raw.firstKeptEntryId,
      });
    } catch {
      // Skip a broken file; keep the rest.
    }
  }
  blocks.sort((a, b) => a.n - b.n);
  return { version: 1, sessionId, blocks };
}
