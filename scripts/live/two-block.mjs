#!/usr/bin/env node
/**
 * Live e2e: two frozen eras, full R1 → D1 → R2 → D2 recall, then Memory: query.
 *
 * /memory is off while planting the second era so a 1-block recall cannot leak
 * era-1 facts into the live window or into Block 2.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  compactQuietly,
  createResults,
  ensureTinyCompactWindow,
  expect,
  fail,
  findMemoryStore,
  finish,
  lastAssistant,
  memoryNotes,
  note,
  plantFacts,
  readBlock,
  readDebug,
  readIndex,
  RpcClient,
  secretsLeftLive,
  textOf,
  tinyRecentTurn,
} from "./harness.mjs";

const ROOT = process.env.HM_LIVE_ROOT || "/tmp/hm-live/e2e-two-block";
const SESSION_DIR = join(ROOT, "sessions");
const WORK = join(ROOT, "work");
const REPORT = join(ROOT, "report.json");
const DEBUG = join(ROOT, "ext.log");

const CITY = "KALMAR-DOCK-19";
const CALLSIGN = "gurnard";
const DEPLOY = "AMBER-SPIRE-3";
const COLOR = "celadon";

async function main() {
  ensureTinyCompactWindow();
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  mkdirSync(SESSION_DIR, { recursive: true });

  const results = createResults("two-block");
  const rpc = new RpcClient({ results, sessionDir: SESSION_DIR, workDir: WORK, debugLog: DEBUG });

  try {
    const state0 = await rpc.send({ type: "get_state" });
    if (!state0.success) throw new Error("get_state failed");
    const sessionId = state0.data.sessionId;
    note(results, "get_state", {
      message: `model=${state0.data?.model?.id || "?"} session=${sessionId}`,
      sessionId,
    });

    const cmds = await rpc.send({ type: "get_commands" });
    const names = (cmds.data?.commands || []).map((c) => c.name);
    expect(results, names.includes("memory"), "/memory command not registered", { names });

    note(results, "era1", { message: "planting era-1 standing facts" });
    await plantFacts(rpc, [
      `The home port city code is ${CITY}.`,
      `The harbor callsign is ${CALLSIGN}.`,
    ]);
    await tinyRecentTurn(rpc, "NEXT1");

    note(results, "compact1", { message: "compacting era 1 into Block 1" });
    await compactQuietly(rpc, results);

    const storeDir = findMemoryStore(SESSION_DIR, sessionId);
    const block1 = storeDir ? readBlock(storeDir, 1) : null;
    expect(results, Boolean(block1), "Block 1 was not written");
    if (block1) {
      expect(results, block1.raw.includes(CITY) && block1.raw.includes(CALLSIGN), "Block 1 missing era-1 secrets");
      expect(results, !block1.raw.includes(DEPLOY) && !block1.raw.includes(COLOR), "Block 1 unexpectedly contains era-2 secrets");
    }

    let msgs = (await rpc.send({ type: "get_messages" })).data?.messages || [];
    let leak = secretsLeftLive(msgs, [CITY, CALLSIGN]);
    note(results, "post-compact-1", {
      message: leak.stillLive.length || leak.inSummary.length ? "era-1 leaked after compact 1" : "era-1 left live window and summary",
      stillLive: leak.stillLive.length,
      inSummary: leak.inSummary.length,
    });
    if (leak.stillLive.length || leak.inSummary.length) {
      throw new Error("era-1 still visible after compact 1; later recall would stay quiet");
    }

    await rpc.slash("/memory off");
    note(results, "memory-off", { message: "memory off before planting era 2" });

    note(results, "era2", { message: "planting era-2 standing facts" });
    await plantFacts(rpc, [
      `The deploy target code is ${DEPLOY}.`,
      `The user's favorite color is ${COLOR}.`,
    ]);
    await tinyRecentTurn(rpc, "NEXT2");

    const debugBeforeCompact2 = readDebug(DEBUG);
    const recallWhileOff = debugBeforeCompact2.filter((e) => e.event === "recall-start");
    expect(
      results,
      recallWhileOff.length === 0,
      "recall ran while /memory was off during era-2 planting",
      { recallStarts: recallWhileOff.length },
    );

    note(results, "compact2", { message: "compacting era 2 into Block 2" });
    await compactQuietly(rpc, results);

    const block2 = storeDir ? readBlock(storeDir, 2) : null;
    const index = storeDir ? readIndex(storeDir) : null;
    expect(results, Boolean(block2), "Block 2 was not written");
    expect(results, index?.blocks?.length === 2, "index.json does not list 2 blocks", {
      count: index?.blocks?.length,
    });
    if (block2) {
      expect(results, block2.raw.includes(DEPLOY) && block2.raw.includes(COLOR), "Block 2 missing era-2 secrets");
      expect(
        results,
        !block2.raw.includes(CITY) && !block2.raw.includes(CALLSIGN),
        "Block 2 contains era-1 secrets; eras were not isolated",
      );
    }

    msgs = (await rpc.send({ type: "get_messages" })).data?.messages || [];
    leak = secretsLeftLive(msgs, [CITY, CALLSIGN, DEPLOY, COLOR]);
    note(results, "post-compact-2", {
      message: leak.stillLive.length || leak.inSummary.length ? "secrets leaked after compact 2" : "all four secrets left live window and summary",
      stillLive: leak.stillLive.length,
      inSummary: leak.inSummary.length,
    });
    if (leak.stillLive.length || leak.inSummary.length) {
      throw new Error("secrets still visible after compact 2; cross-block recall would stay quiet");
    }

    await rpc.slash("/memory on");
    const debugBeforeJoint = readDebug(DEBUG).length;

    note(results, "joint-ask", { message: "asking a question that needs both frozen eras" });
    await rpc.prompt(
      [
        "Do not use tools.",
        "Two standing facts were given much earlier: a home port city code, and a deploy target code.",
        "Reply with only those two codes, in that order, separated by a single space.",
      ].join("\n"),
      360000,
    );

    msgs = (await rpc.send({ type: "get_messages" })).data?.messages || [];
    const notesAfterJoint = memoryNotes(msgs);
    const jointNoteText = notesAfterJoint.map(textOf).join("\n");
    const jointAnswer = textOf(lastAssistant(msgs));
    const noteHasBoth = jointNoteText.includes(CITY) && jointNoteText.includes(DEPLOY);
    const answerHasBoth = jointAnswer.includes(CITY) && jointAnswer.includes(DEPLOY);
    const wellTyped = notesAfterJoint.every(
      (m) => m.customType === "historical-memory-note" && textOf(m).startsWith("Historical memory note:"),
    );

    const debugAfterJoint = readDebug(DEBUG).slice(debugBeforeJoint);
    const recallStarts = debugAfterJoint.filter((e) => e.event === "recall-start");
    const recallDones = debugAfterJoint.filter((e) => e.event === "recall-done");
    const blockCalls = debugAfterJoint.filter((e) => e.event === "block-call");
    const dStarts = debugAfterJoint.filter((e) => e.event === "deliberation-start");
    const dRounds = new Set(dStarts.map((e) => e.round));
    const fullPlan = recallDones.some((e) => e.plan === "full");
    const twoBlocks = recallStarts.some((e) => e.blocks === 2);

    note(results, "joint-check", {
      message: `notes=${notesAfterJoint.length} noteHasBoth=${noteHasBoth} answerHasBoth=${answerHasBoth} planFull=${fullPlan} blockCalls=${blockCalls.length} dRounds=${[...dRounds].join(",")}`,
      notes: notesAfterJoint.length,
      noteHasBoth,
      answerHasBoth,
      wellTyped,
      fullPlan,
      twoBlocks,
      blockCalls: blockCalls.length,
      dRounds: [...dRounds],
      notePreview: jointNoteText.slice(0, 400),
      answerPreview: jointAnswer.slice(0, 400),
    });

    expect(results, notesAfterJoint.length >= 1, "no historical-memory-note after two-block question");
    expect(results, wellTyped, "note is missing customType or Historical memory note: prefix");
    expect(results, twoBlocks, "recall-start did not report 2 blocks");
    expect(results, fullPlan, "recall-done plan was not full");
    expect(results, blockCalls.length >= 4, "expected at least 4 block-agent calls (2 blocks × 2 rounds)", {
      blockCalls: blockCalls.length,
    });
    expect(results, dRounds.has(1) && dRounds.has(2), "did not observe both deliberation rounds", {
      dRounds: [...dRounds],
    });
    expect(results, noteHasBoth, "two-block note did not synthesize both era codes");
    expect(results, answerHasBoth, "main agent did not answer with both era codes");
    expect(results, rpc.steerCount() === 0, "unexpected steer events during joint ask", {
      extraSteer: rpc.steerCount(),
    });

    const debugBeforeEcho = readDebug(DEBUG).length;
    note(results, "memory-echo", { message: "asking via echo Memory: for the era-1 callsign" });
    await rpc.prompt(
      [
        "Use the bash tool exactly once, with this exact command and no other flags:",
        `echo "Memory: What harbor callsign did the user give?"`,
        "After you have that tool result, wait for the next model call. Then reply with only the callsign.",
      ].join("\n"),
      360000,
    );

    const afterEcho = (await rpc.send({ type: "get_messages" })).data?.messages || [];
    const echoNotes = memoryNotes(afterEcho);
    const echoNoteText = echoNotes.map(textOf).join("\n");
    const echoAnswer = textOf(lastAssistant(afterEcho));
    const usedEcho = afterEcho.some((m) => {
      const t = textOf(m) + JSON.stringify(m.content || "");
      return t.includes("Memory:") && t.includes("callsign");
    });
    const fruitInNotes = echoNoteText.toLowerCase().includes(CALLSIGN);
    const fruitInAnswer = echoAnswer.toLowerCase().includes(CALLSIGN);
    const debugAfterEcho = readDebug(DEBUG).slice(debugBeforeEcho);
    const echoFull = debugAfterEcho.some((e) => e.event === "recall-done" && e.plan === "full");

    note(results, "echo-check", {
      message: `usedEcho=${usedEcho} callsignInNotes=${fruitInNotes} callsignInAnswer=${fruitInAnswer} echoFull=${echoFull}`,
      usedEcho,
      fruitInNotes,
      fruitInAnswer,
      echoFull,
      notes: echoNotes.length,
      notePreview: echoNoteText.slice(0, 400),
      answerPreview: echoAnswer.slice(0, 400),
      extraSteer: rpc.steerCount(),
    });

    expect(results, usedEcho, "agent did not run echo Memory: query");
    expect(results, fruitInNotes, "Memory: cycle did not put the callsign in a historical memory note");
    expect(results, fruitInAnswer, "main agent did not answer with the callsign after Memory: query");
    expect(results, echoFull, "Memory: recall did not use the full two-block plan");
    expect(results, rpc.steerCount() === 0, "unexpected steer events during Memory: query");
  } catch (err) {
    fail(results, err instanceof Error ? err.message : String(err));
  } finally {
    finish(results, REPORT, rpc, SESSION_DIR);
  }
}

main();
