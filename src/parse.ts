export type BlockContribution =
  | { kind: "no"; blockNumber: number }
  | { kind: "yes"; blockNumber: number; text: string };

export function parseBlockOutput(raw: string, blockNumber: number): BlockContribution {
  const trimmed = raw.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return { kind: "no", blockNumber };

  const lines = trimmed.split(/\r?\n/);
  const first = (lines[0] ?? "").trim().toLowerCase();

  if (first === "no") return { kind: "no", blockNumber };

  if (first === "yes") {
    const body = lines.slice(1).join("\n").trim();
    if (!body) return { kind: "no", blockNumber };
    return { kind: "yes", blockNumber, text: body };
  }

  // Models sometimes omit the yes/no line and jump to content, or write "Yes: ...".
  const yesPrefix = trimmed.match(/^yes\b[:\s-]*/i);
  if (yesPrefix) {
    const body = trimmed.slice(yesPrefix[0].length).trim();
    if (!body) return { kind: "no", blockNumber };
    return { kind: "yes", blockNumber, text: body };
  }

  return { kind: "no", blockNumber };
}

export function formatContributionForDeliberation(contribution: BlockContribution): string {
  if (contribution.kind === "no") return "no";
  return `yes\n${contribution.text}`;
}

export function parseDeliberationNote(raw: string): string | null {
  const trimmed = raw.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return null;

  const normalized = trimmed.toLowerCase().replace(/[.!\s]+$/g, "");
  const sentinels = [
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
  if (sentinels.includes(normalized)) return null;

  // A lone "no" paragraph with no other substance.
  if (/^no\s*$/i.test(trimmed)) return null;

  return trimmed;
}

export function allBlocksSaidNo(contributions: BlockContribution[]): boolean {
  return contributions.length === 0 || contributions.every((c) => c.kind === "no");
}

export function yesContributions(contributions: BlockContribution[]): Array<{
  blockNumber: number;
  text: string;
}> {
  return contributions
    .filter((c): c is { kind: "yes"; blockNumber: number; text: string } => c.kind === "yes")
    .map((c) => ({ blockNumber: c.blockNumber, text: c.text }));
}
