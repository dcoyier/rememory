export const CUSTOM_TYPE = "historical-memory-note";
export const INDEX_ENTRY_TYPE = "historical-memory";
export const NOTE_PREFIX = "Historical memory note:";
export const STORE_DIR_NAME = "historical-memory";
export const STATUS_KEY = "historical-memory";

export const BLOCK_MAX_TOKENS = 1024;
export const DELIBERATION_MAX_TOKENS = 1536;
export const TOKEN_CHAR_RATIO = 4;
/** Leave room for the completion when checking whether a prompt fits. */
export const FIT_OUTPUT_RESERVE = 1024;

export const EMPTY_DELIBERATION_SENTINELS = [
  "",
  "no",
  "n/a",
  "none",
  "no memory note",
  "produce no memory note",
  "no_memory_note",
];
