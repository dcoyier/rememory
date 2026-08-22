import { EMPTY_DELIBERATION_SENTINELS } from "./constants.ts";

export type BlockContribution =
  | { kind: "no"; blockNumber: number }
  | { kind: "yes"; blockNumber: number; text: string };

export function parseBlockOutput(raw: string, blockNumber: number): BlockContribution {
  const trimmed = raw.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return { kind: "no", blockNumber };

  const lines = trimmed.split(/\r?\n/);
  while (lines.length > 0 && !lines[0]?.trim()) lines.shift();
  const first = (lines[0] ?? "").trim().toLowerCase().replace(/[.!]+$/, "");

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
  if (EMPTY_DELIBERATION_SENTINELS.includes(normalized)) return null;
  return trimmed;
}

export function allBlocksSaidNo(contributions: BlockContribution[]): boolean {
  return contributions.length === 0 || contributions.every((c) => c.kind === "no");
}
