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

Notes are spliced into this call’s `context` snapshot so the model sees them on this request. `sendMessage({ triggerTurn: false })` writes the note into the session once per body (not on every tool-loop call). They are never stripped, never steering, and they freeze later as part of whatever span compact takes.

Block and deliberation calls use the **same model as the main agent**, as bare completions (no tools, no Pi system prompt). If a block + current context cannot fit that model’s window, that block is treated as `no` rather than truncated.

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

Requires a Pi that exposes `session_before_compact` (with `preparation.messagesToSummarize`), `session_compact` / `session_compact_failed`, and a `context` hook that can return `{ messages }`. Notes are stored with `sendMessage({ triggerTurn: false })`.

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

## Tests

```bash
npm install
npm test
```
