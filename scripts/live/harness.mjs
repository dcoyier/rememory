#!/usr/bin/env node
/**
 * Shared RPC harness for live Pi historical-memory tests.
 * Never prints secret values.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PI = process.env.PI_BIN || "/tmp/hm-live/npm/node_modules/.bin/pi";
export const EXT = process.env.HM_EXT || "/agent/pi-historical-memory/src/index.ts";
export const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || "/tmp/hm-live/agent";
export const COMPACT_INSTRUCTIONS =
  "Summarize only that the user sent short acknowledgements. Do not mention any project names, codenames, cities, harbors, colors, fruits, deploy targets, callsigns, or standing facts.";

export function ensureTinyCompactWindow() {
  const settingsPath = join(AGENT_DIR, "settings.json");
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
  settings.compaction = {
    enabled: true,
    keepRecentTokens: 1,
    reserveTokens: 0,
  };
  mkdirSync(AGENT_DIR, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

export function readOpenRouterKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  const file = process.env.OPENROUTER_KEY_FILE || "/tmp/hm-live/openrouter.key";
  if (!existsSync(file)) throw new Error(`OpenRouter key not found at ${file}`);
  return readFileSync(file, "utf8").trim();
}

export function createResults(name) {
  return {
    name,
    startedAt: new Date().toISOString(),
    steps: [],
    ok: false,
    errors: [],
  };
}

export function note(results, step, data) {
  const entry = { step, at: new Date().toISOString(), ...data };
  results.steps.push(entry);
  const message = data.message || JSON.stringify(data).slice(0, 220);
  console.error(`[${results.name}:${step}] ${message}`);
  return entry;
}

export function fail(results, message, extra = {}) {
  results.errors.push({ message, ...extra });
  note(results, "fail", { message, ...extra });
}

export function expect(results, cond, message, extra = {}) {
  if (!cond) fail(results, message, extra);
  return cond;
}

export function textOf(m) {
  if (!m) return "";
  if (typeof m.content === "string") return m.content;
  if (typeof m.summary === "string") return m.summary;
  if (Array.isArray(m.content)) {
    return m.content
      .map((b) => (typeof b?.text === "string" ? b.text : ""))
      .join("\n");
  }
  return "";
}

export function memoryNotes(messages) {
  return (messages || []).filter(
    (m) =>
      m.role === "custom" &&
      (m.customType === "historical-memory-note" ||
        String(m.content || "").includes("Historical memory note:")),
  );
}

export function lastAssistant(messages) {
  return [...(messages || [])].reverse().find((m) => m.role === "assistant");
}

export function findSessionFiles(sessionDir) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) walk(p);
      else if (name.name.endsWith(".jsonl")) out.push(p);
    }
  };
  walk(sessionDir);
  return out;
}

export function findMemoryStore(sessionDir, sessionId) {
  const root = join(sessionDir, "historical-memory");
  if (!existsSync(root)) return null;
  if (sessionId && existsSync(join(root, sessionId))) return join(root, sessionId);
  const kids = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  return kids[0] ? join(root, kids[0].name) : null;
}

export function readBlock(storeDir, n) {
  const file = join(storeDir, "blocks", `${String(n).padStart(4, "0")}.json`);
  if (!existsSync(file)) return null;
  return { file, raw: readFileSync(file, "utf8"), json: JSON.parse(readFileSync(file, "utf8")) };
}

export function readIndex(storeDir) {
  const file = join(storeDir, "index.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

export function readDebug(path) {
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class RpcClient {
  constructor(options) {
    this.buf = "";
    this.pending = new Map();
    this.events = [];
    this.req = 0;
    this.closed = false;
    this.results = options.results;
    this.child = spawn(
      PI,
      [
        "--mode",
        "rpc",
        "--provider",
        "openrouter",
        "--model",
        "stealth/ox-alpha",
        "--thinking",
        "low",
        "--extension",
        EXT,
        "--no-extensions",
        "--session-dir",
        options.sessionDir,
        "--tools",
        "bash",
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "--offline",
      ],
      {
        cwd: options.workDir,
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: AGENT_DIR,
          PI_SKIP_VERSION_CHECK: "1",
          PI_OFFLINE: "1",
          OPENROUTER_API_KEY: readOpenRouterKey(),
          HISTORICAL_MEMORY_DEBUG: options.debugLog || "",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child.stdout.on("data", (chunk) => this.onData(chunk));
    this.child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      if (text.trim()) console.error("[pi-stderr]", text.trim().slice(0, 400));
    });
    this.child.on("exit", (code) => {
      this.closed = true;
      note(this.results, "pi-exit", { message: `pi exited ${code}`, code });
      for (const [, p] of this.pending) p.reject(new Error(`pi exited ${code}`));
      this.pending.clear();
    });
  }

  onData(chunk) {
    this.buf += chunk.toString("utf8");
    for (;;) {
      const nl = this.buf.indexOf("\n");
      if (nl < 0) break;
      let line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        console.error("[bad-json]", line.slice(0, 200));
        continue;
      }
      this.events.push(msg);
      if (msg.type === "response" && msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        p.resolve(msg);
      }
    }
  }

  send(obj) {
    if (this.closed) return Promise.reject(new Error("pi closed"));
    const id = obj.id || `r${++this.req}`;
    const payload = { ...obj, id };
    const p = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.child.stdin.write(JSON.stringify(payload) + "\n");
    return p;
  }

  async waitFor(predicate, timeoutMs, label) {
    const start = Date.now();
    let seen = 0;
    while (Date.now() - start < timeoutMs) {
      for (; seen < this.events.length; seen++) {
        if (predicate(this.events[seen])) return this.events[seen];
      }
      await sleep(50);
    }
    throw new Error(`timeout waiting for ${label} after ${timeoutMs}ms`);
  }

  async prompt(message, timeoutMs = 180000) {
    const before = this.events.length;
    const res = await this.send({ type: "prompt", message });
    if (!res.success) throw new Error(`prompt rejected: ${res.error || JSON.stringify(res)}`);
    await this.waitFor(
      (e) => this.events.indexOf(e) >= before && e.type === "agent_settled",
      timeoutMs,
      "agent_settled",
    );
    return res;
  }

  async slash(command) {
    await this.send({ type: "prompt", message: command });
    await sleep(300);
  }

  steerCount() {
    return this.events.filter((e) => e.type === "steer" || e.deliverAs === "steer").length;
  }

  close() {
    try {
      this.child.stdin.end();
    } catch {
      // already closed
    }
    setTimeout(() => {
      if (!this.closed) this.child.kill("SIGTERM");
    }, 1500);
  }
}

export async function plantFacts(rpc, facts, ack = "OK") {
  const lines = [
    `Do not use any tools. Reply with exactly ${ack} and nothing else.`,
    "Remember these standing facts for later in this session:",
    ...facts.map((fact, i) => `${i + 1}. ${fact}`),
    "These are durable user facts, not a one-off task choice.",
  ];
  await rpc.prompt(lines.join("\n"));
}

export async function tinyRecentTurn(rpc, ack = "NEXT") {
  await rpc.prompt(`Do not use tools. Reply with exactly ${ack}. Do not repeat earlier facts.`);
}

export async function compactQuietly(rpc, results) {
  const compactRes = await rpc.send({
    type: "compact",
    customInstructions: COMPACT_INSTRUCTIONS,
  });
  if (!compactRes.success) {
    fail(results, "compact failed", { error: compactRes.error, data: compactRes.data });
    throw new Error(`compact failed: ${compactRes.error || "unknown"}`);
  }
  note(results, "compact-ok", { message: "compact succeeded", data: compactRes.data });
  return compactRes;
}

export function secretsLeftLive(messages, secrets) {
  const summaryText = (messages || [])
    .filter((m) => m.role === "compactionSummary")
    .map(textOf)
    .join("\n");
  const liveText = (messages || [])
    .filter((m) => m.role !== "compactionSummary" && m.customType !== "historical-memory-note")
    .map(textOf)
    .join("\n");
  const stillLive = secrets.filter((s) => liveText.includes(s));
  const inSummary = secrets.filter(
    (s) => summaryText.includes(s) || summaryText.toLowerCase().includes(s.toLowerCase()),
  );
  return { stillLive, inSummary, summaryText };
}

export function writeReport(reportPath, results) {
  results.finishedAt = new Date().toISOString();
  results.ok = results.errors.length === 0;
  mkdirSync(join(reportPath, ".."), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(results, null, 2));
}

export function finish(results, reportPath, rpc, sessionDir) {
  results.sessionFiles = findSessionFiles(sessionDir);
  writeReport(reportPath, results);
  note(results, "done", {
    message: results.ok ? "all checks passed" : `${results.errors.length} check(s) failed`,
  });
  rpc.close();
  if (!results.ok) process.exitCode = 1;
}
