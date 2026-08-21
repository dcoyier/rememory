import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
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
  return join(sessionDir, "historical-memory", sessionId);
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

  get metas(): BlockMeta[] {
    return this.index.blocks;
  }

  loadAll(): FrozenBlock[] {
    return this.index.blocks.map((meta) => this.load(meta.n));
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
    return { version: 1, sessionId, blocks: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as StoreIndex;
    if (parsed.version !== 1 || !Array.isArray(parsed.blocks)) {
      return { version: 1, sessionId, blocks: [] };
    }
    return { ...parsed, sessionId: parsed.sessionId || sessionId };
  } catch {
    return { version: 1, sessionId, blocks: [] };
  }
}
