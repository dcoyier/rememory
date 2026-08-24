# pi-historical-memory

Pi extension: when context is compacted, the departing window is frozen intact as Block N on disk. Before every main-agent model call, frozen blocks are re-read against the current context. Useful past information is inserted as an ordinary session message (same kind of transcript item as a tool result).

## Behavior

**Freeze.** On `session_before_compact`, snapshot `messagesToSummarize` + split-turn prefix in memory. The snapshot is written as Block N only after `session_compact` succeeds; cancelled or failed compact drops it so the same window is not frozen twice. Pi’s normal compact still runs; that summary is the continuity patch. Recall does not run during compact.

**Recall.** On the `context` hook (every model call):

| Blocks | What runs |
| --- | --- |
| 0 | Nothing |
| 1 | One block-agent call. `yes` text becomes the note. No deliberation. |
| 2+ | Round 1 all blocks in parallel → if all `no`, stop → else D1 → Round 2 all blocks in parallel (including those that said `no`) → final note |

Each turn, `before_agent_start` appends a short instruction to Pi’s main-agent system prompt: ask memory a specific question with `echo "Memory: <question>"`. That tool result is visible to the next memory pass.

Notes are spliced into this call’s `context` snapshot so the model sees them on this request. `sendMessage({ triggerTurn: false })` writes the note into the session once per body (not on every tool-loop call). They are never stripped, never steering, and they freeze later as part of whatever span compact takes. The everyday note target is 1,000 tokens; the first recall after a successful compact may go substantially longer (hard cap 4,096).

Block and deliberation calls use the **same model as the main agent**, as bare completions (no tools, no Pi system prompt). Nested calls always send the full frozen block and the full current context; they are not capped to the main agent’s window and blocks are never truncated. A failed nested call is treated as `no` and does not fail the main agent.

## Install

Add the package (path or git) to Pi:

```json
{
  "packages": [
    "/path/to/pi-historical-memory"
  ]
}
```

Or load the extension directly:

```bash
pi -e /path/to/pi-historical-memory/src/index.ts
```

You can also copy or symlink this folder into `~/.pi/agent/extensions/`. `/memory off` is process-local; it does not persist across Pi restarts.

Requires a Pi that exposes `session_before_compact` (with `preparation.messagesToSummarize`), `session_compact`, and a `context` hook that can return `{ messages }`. Notes are spliced into the current request and persisted with `sendMessage({ triggerTurn: false, deliverAs: "nextTurn" })` so they are not steered mid-turn.

## Disk layout

```
{sessionDir}/historical-memory/{sessionId}/
  index.json
  blocks/0001.json
  blocks/0002.json
```

Forked sessions copy the parent archive when the new session has no blocks yet.

## Commands

- `/memory` — status (on/off, block count, path)
- `/memory off` / `/memory on` — toggle for this process

## Future

Once the block count hits a threshold, later work could merge them through a binary tree so the archive does not grow without bound. Pairwise merges would keep older history addressable without running recall over every leaf block.

## Tests

```bash
npm install
npm test
```

Live RPC tests against a real Pi + model (OpenRouter `stealth/ox-alpha` by default) live in `scripts/live/`. They need `PI_BIN`, `PI_CODING_AGENT_DIR`, and `OPENROUTER_API_KEY` or `/tmp/hm-live/openrouter.key`. The harness forces `compaction.keepRecentTokens: 1` so a short chat can compact without a huge filler turn.

```bash
npm run test:live
```

- `scripts/live/two-block.mjs` — two isolated eras, full R1 → D1 → R2 → D2 recall, then `echo "Memory:"`
- `scripts/live/toggle-inherit.mjs` — `/memory off` stays silent, `/memory on` recovers, notes persist once, freeze into the next block, and a child session inherits the archive
