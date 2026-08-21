export function isAbort(error: unknown): boolean {
  return (
    (error instanceof Error && (error.name === "AbortError" || error.message === "aborted")) ||
    (typeof error === "object" && error !== null && "name" in error && (error as { name: unknown }).name === "AbortError")
  );
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
