# pi-historical-memory

Pi extension: when context is compacted, the departing window is frozen intact as Block N on disk. Before every main-agent model call, frozen blocks are re-read against the current context. Useful past information is inserted as an ordinary session message (same kind of transcript item as a tool result).

## Behavior

**Freeze.** On `session_before_compact`, write `messagesToSummarize` + split-turn prefix to disk as the next block. Pi’s normal compact still runs; that summary is the continuity patch. Recall does not run during compact or branch summarization.

**Recall.** On the `context` hook (every model call):

| Blocks | What runs |
| --- | --- |
| 0 | Nothing |
| 1 | One block-agent call. `yes` text becomes the note. No deliberation. |
| 2+ | Round 1 all blocks in parallel → if all `no`, stop → else D1 → Round 2 all blocks in parallel (including those that said `no`) → final note |

Notes are appended with `sendMessage({ triggerTurn: false })` so they are real session messages, then spliced into this call’s snapshot only if it does not already contain them. They are never stripped, never steering, and they freeze later as part of whatever span compact takes.

Block and deliberation calls use the **same model as the main agent**, as bare completions (no tools, no Pi system prompt). If a block + current context cannot fit that model’s window, that block is treated as `no` rather than truncated.

## Install

From a local checkout:

```bash
# settings.json packages list, or:
pi -e /path/to/pi-historical-memory/src/index.ts
```

Pi package manifest is in `package.json` (`pi.extensions`). You can also copy/symlink this folder into `~/.pi/agent/extensions/`.

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
