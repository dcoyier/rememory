export const CUSTOM_TYPE = "historical-memory-note";
export const INDEX_ENTRY_TYPE = "historical-memory";
export const NOTE_PREFIX = "Historical memory note:";
export const STORE_DIR_NAME = "historical-memory";
export const STATUS_KEY = "historical-memory";

/** High enough that a reasoning model can think and still emit yes/no text. */
export const BLOCK_MAX_TOKENS = 8192;
export const DELIBERATION_MAX_TOKENS = 8192;
/** Ceiling for a note on the first recall after a successful compact. */
export const AFTER_COMPACT_NOTE_MAX_TOKENS = 16384;
export const TOKEN_CHAR_RATIO = 4;

export const EMPTY_DELIBERATION_SENTINELS = [
  "",
  "no",
  "n/a",
  "none",
  "no memory note",
  "produce no memory note",
  "no_memory_note",
  "no note",
  "nothing useful",
  "nothing useful surfaced",
];
