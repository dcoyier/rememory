export function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && (error as { name: unknown }).name === "AbortError";
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
