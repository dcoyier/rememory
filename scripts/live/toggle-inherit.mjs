#!/usr/bin/env node
/**
 * Live e2e: /memory off stays silent, /memory on recovers, a note is persisted
 * once, that note freezes into the next block, and a child session inherits
 * the parent archive.
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

const ROOT = process.env.HM_LIVE_ROOT || "/tmp/hm-live/e2e-toggle-inherit";
const SESSION_DIR = join(ROOT, "sessions");
const WORK = join(ROOT, "work");
const REPORT = join(ROOT, "report.json");
const DEBUG = join(ROOT, "ext.log");
const PROJECT = "IVORY-KITE-4";

async function main() {
  ensureTinyCompactWindow();
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  mkdirSync(SESSION_DIR, { recursive: true });

  const results = createResults("toggle-inherit");
  const rpc = new RpcClient({ results, sessionDir: SESSION_DIR, workDir: WORK, debugLog: DEBUG });

  try {
    const state0 = await rpc.send({ type: "get_state" });
    if (!state0.success) throw new Error("get_state failed");
    const parentSessionId = state0.data.sessionId;
    const parentSessionFile = state0.data.sessionFile;
    note(results, "get_state", {
      message: `model=${state0.data?.model?.id || "?"} session=${parentSessionId}`,
      sessionId: parentSessionId,
      sessionFile: parentSessionFile,
    });

    const cmds = await rpc.send({ type: "get_commands" });
    const names = (cmds.data?.commands || []).map((c) => c.name);
    expect(results, names.includes("memory"), "/memory command not registered", { names });

    note(results, "plant", { message: "planting standing project name" });
    await plantFacts(rpc, [`The secret project name is ${PROJECT}.`]);
    await tinyRecentTurn(rpc, "NEXT");

    note(results, "compact1", { message: "compacting planted fact into Block 1" });
    await compactQuietly(rpc, results);

    const parentStore = findMemoryStore(SESSION_DIR, parentSessionId);
    const block1 = parentStore ? readBlock(parentStore, 1) : null;
    expect(results, Boolean(block1), "Block 1 was not written");
    if (block1) {
      expect(results, block1.raw.includes(PROJECT), "Block 1 missing planted project name");
    }

    let msgs = (await rpc.send({ type: "get_messages" })).data?.messages || [];
    const leak = secretsLeftLive(msgs, [PROJECT]);
    note(results, "post-compact-1", {
      message: leak.stillLive.length || leak.inSummary.length ? "project leaked after compact" : "project left live window and summary",
      stillLive: leak.stillLive.length,
      inSummary: leak.inSummary.length,
    });
    if (leak.stillLive.length || leak.inSummary.length) {
      throw new Error("project still visible after compact 1");
    }

    await rpc.slash("/memory off");
    const debugBeforeOff = readDebug(DEBUG).length;
    note(results, "ask-while-off", { message: "asking for the project with memory off" });
    await rpc.prompt(
      "Do not use tools. What is the secret project name from earlier in this session? Reply with only that name, or UNKNOWN if you do not have it.",
      180000,
    );

    msgs = (await rpc.send({ type: "get_messages" })).data?.messages || [];
    const notesWhileOff = memoryNotes(msgs);
    const offAnswer = textOf(lastAssistant(msgs));
    const debugDuringOff = readDebug(DEBUG).slice(debugBeforeOff);
    const skipDisabled = debugDuringOff.some((e) => e.event === "context-skip-reason" && e.skip === "disabled");
    const recallWhileOff = debugDuringOff.filter((e) => e.event === "recall-start");

    note(results, "off-check", {
      message: `notes=${notesWhileOff.length} answerHasProject=${offAnswer.includes(PROJECT)} skipDisabled=${skipDisabled}`,
      notes: notesWhileOff.length,
      answerHasProject: offAnswer.includes(PROJECT),
      skipDisabled,
      recallStarts: recallWhileOff.length,
      answerPreview: offAnswer.slice(0, 300),
    });
    expect(results, notesWhileOff.length === 0, "a memory note was inserted while /memory was off");
    expect(results, !offAnswer.includes(PROJECT), "main agent answered with the project while memory was off");
    expect(
      results,
      skipDisabled && recallWhileOff.length === 0,
      "recall was not skipped as disabled while /memory was off",
      { skipDisabled, recallStarts: recallWhileOff.length },
    );

    await rpc.slash("/memory on");
    note(results, "ask-while-on", { message: "asking for the project with memory on" });
    await rpc.prompt(
      "Do not use tools. What is the secret project name from earlier in this session? Reply with only that name.",
      240000,
    );

    msgs = (await rpc.send({ type: "get_messages" })).data?.messages || [];
    const notesOn = memoryNotes(msgs);
    const onAnswer = textOf(lastAssistant(msgs));
    const noteText = notesOn.map(textOf).join("\n");
    const wellTyped = notesOn.every(
      (m) => m.customType === "historical-memory-note" && textOf(m).startsWith("Historical memory note:"),
    );

    note(results, "on-check", {
      message: `notes=${notesOn.length} noteHasProject=${noteText.includes(PROJECT)} answerHasProject=${onAnswer.includes(PROJECT)}`,
      notes: notesOn.length,
      noteHasProject: noteText.includes(PROJECT),
      answerHasProject: onAnswer.includes(PROJECT),
      wellTyped,
      notePreview: noteText.slice(0, 400),
      answerPreview: onAnswer.slice(0, 300),
    });
    expect(results, notesOn.length === 1, "expected exactly one memory note after turning memory on", {
      notes: notesOn.length,
    });
    expect(results, wellTyped, "note is missing customType or prefix");
    expect(results, noteText.includes(PROJECT), "memory note did not surface the project name");
    expect(results, onAnswer.includes(PROJECT), "main agent did not answer with the project name");

    note(results, "ask-again", { message: "asking the same question to check persist-once" });
    await rpc.prompt(
      "Do not use tools. Repeat only the secret project name already in this conversation.",
      240000,
    );
    msgs = (await rpc.send({ type: "get_messages" })).data?.messages || [];
    const notesAgain = memoryNotes(msgs);
    const againAnswer = textOf(lastAssistant(msgs));
    const uniqueBodies = new Set(notesAgain.map((m) => textOf(m).trim()));
    note(results, "persist-once", {
      message: `notes=${notesAgain.length} uniqueBodies=${uniqueBodies.size}`,
      notes: notesAgain.length,
      uniqueBodies: uniqueBodies.size,
      answerHasProject: againAnswer.includes(PROJECT),
    });
    expect(results, notesAgain.length === 1, "a second note was persisted for the same recall", {
      notes: notesAgain.length,
    });
    expect(results, againAnswer.includes(PROJECT), "follow-up answer lost the project name");

    await tinyRecentTurn(rpc, "NEXT2");
    note(results, "compact2", { message: "compacting so the memory note freezes into Block 2" });
    await compactQuietly(rpc, results);

    const block2 = parentStore ? readBlock(parentStore, 2) : null;
    const index = parentStore ? readIndex(parentStore) : null;
    expect(results, index?.blocks?.length === 2, "parent archive does not have 2 blocks after second compact", {
      count: index?.blocks?.length,
    });
    expect(results, Boolean(block2), "Block 2 was not written");
    if (block2) {
      const frozeNote =
        block2.raw.includes("historical-memory-note") || block2.raw.includes("Historical memory note:");
      expect(results, frozeNote, "Block 2 does not contain the earlier memory note");
      expect(results, block2.raw.includes(PROJECT), "Block 2 does not contain the project name from the note");
      note(results, "note-froze", {
        message: frozeNote ? "Block 2 contains the earlier memory note" : "Block 2 missing the note",
      });
    }

    const parentState = await rpc.send({ type: "get_state" });
    const parentFile = parentState.data?.sessionFile || parentSessionFile;
    note(results, "new-session", { message: "starting a child session that should inherit the archive" });
    const childRes = await rpc.send({ type: "new_session", parentSession: parentFile });
    if (!childRes.success) throw new Error(`new_session failed: ${childRes.error || "unknown"}`);

    const childState = await rpc.send({ type: "get_state" });
    const childSessionId = childState.data?.sessionId;
    expect(results, Boolean(childSessionId) && childSessionId !== parentSessionId, "child session id was not distinct", {
      parentSessionId,
      childSessionId,
    });

    const childStore = findMemoryStore(SESSION_DIR, childSessionId);
    const childIndex = childStore ? readIndex(childStore) : null;
    note(results, "inherit-store", {
      message: childIndex
        ? `child store has ${childIndex.blocks?.length ?? 0} blocks`
        : "child store missing",
      childStore,
      childBlocks: childIndex?.blocks?.length ?? 0,
    });
    expect(results, Boolean(childStore), "child historical-memory store was not created");
    expect(results, childIndex?.blocks?.length === 2, "child did not inherit 2 parent blocks", {
      count: childIndex?.blocks?.length,
    });
    const childBlock1 = childStore ? readBlock(childStore, 1) : null;
    expect(results, Boolean(childBlock1?.raw.includes(PROJECT)), "inherited Block 1 missing project name");

    const childMsgsBefore = (await rpc.send({ type: "get_messages" })).data?.messages || [];
    expect(
      results,
      !childMsgsBefore.map(textOf).join("\n").includes(PROJECT),
      "child live messages already contain the project; inherit recall would stay quiet",
    );

    note(results, "child-ask", { message: "asking the child session for the inherited project name" });
    await rpc.prompt(
      "Do not use tools. What is the secret project name from earlier history? Reply with only that name.",
      240000,
    );
    const childMsgs = (await rpc.send({ type: "get_messages" })).data?.messages || [];
    const childNotes = memoryNotes(childMsgs);
    const childNoteText = childNotes.map(textOf).join("\n");
    const childAnswer = textOf(lastAssistant(childMsgs));
    note(results, "child-check", {
      message: `notes=${childNotes.length} noteHasProject=${childNoteText.includes(PROJECT)} answerHasProject=${childAnswer.includes(PROJECT)}`,
      notes: childNotes.length,
      noteHasProject: childNoteText.includes(PROJECT),
      answerHasProject: childAnswer.includes(PROJECT),
      notePreview: childNoteText.slice(0, 400),
      answerPreview: childAnswer.slice(0, 300),
      extraSteer: rpc.steerCount(),
    });
    expect(results, childNotes.length >= 1, "child session did not insert a memory note from inherited blocks");
    expect(results, childNoteText.includes(PROJECT), "child memory note missing the inherited project name");
    expect(results, childAnswer.includes(PROJECT), "child agent did not answer with the inherited project name");
    expect(results, rpc.steerCount() === 0, "unexpected steer events", { extraSteer: rpc.steerCount() });
  } catch (err) {
    fail(results, err instanceof Error ? err.message : String(err));
  } finally {
    finish(results, REPORT, rpc, SESSION_DIR);
  }
}

main();
