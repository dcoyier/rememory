import { CUSTOM_TYPE, NOTE_PREFIX } from "./constants.ts";
import { isReadableThinking } from "./thinking.ts";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType?: string; data?: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; name: string; id?: string; arguments?: Record<string, unknown> }
  | { type: string; [key: string]: unknown };

export type SerializedMessage = {
  role?: string;
  customType?: string;
  content?: unknown;
  display?: boolean;
  details?: unknown;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  summary?: string;
  command?: string;
  output?: string;
  [key: string]: unknown;
};

function asText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    if (content == null) return "";
    if (typeof content === "object" && "text" in content && typeof content.text === "string") {
      return content.text;
    }
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as ContentBlock;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (b.type === "image") {
      const mime = typeof b.mimeType === "string" ? b.mimeType : "unknown";
      parts.push(`[image omitted: ${mime}]`);
    } else if (isReadableThinking(b)) {
      const thinking = "thinking" in b ? String(b.thinking) : "";
      parts.push(`[thinking] ${thinking}`);
    }
  }
  return parts.join("\n");
}

function formatToolCall(block: ContentBlock): string {
  const name = "name" in block && typeof block.name === "string" ? block.name : "tool";
  const rawArgs = "arguments" in block && block.arguments && typeof block.arguments === "object" ? block.arguments : {};
  let argsStr = "";
  try {
    argsStr = JSON.stringify(rawArgs);
  } catch {
    argsStr = String(rawArgs);
  }
  return `${name}(${argsStr})`;
}

/**
 * Lossless-enough text serialization of a conversation for block/deliberation prompts.
 * Tool results are not truncated. Images become placeholders so prompts stay in-window;
 * the on-disk block file still stores the original messages.
 */
export function serializeMessages(messages: SerializedMessage[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    const role = msg.role ?? "unknown";

    if (role === "user") {
      const text = asText(msg.content);
      if (text) parts.push(`[User]: ${text}`);
      continue;
    }

    if (role === "assistant") {
      if (typeof msg.content === "string") {
        if (msg.content) parts.push(`[Assistant]: ${msg.content}`);
        continue;
      }
      const content = Array.isArray(msg.content) ? (msg.content as ContentBlock[]) : [];
      const thinking: string[] = [];
      const toolCalls: string[] = [];
      const texts: string[] = [];
      for (const block of content) {
        if (isReadableThinking(block)) {
          thinking.push("thinking" in block ? String(block.thinking) : "");
        } else if (block.type === "toolCall") {
          toolCalls.push(formatToolCall(block));
        } else if (block.type === "text" && typeof block.text === "string") {
          texts.push(block.text);
        } else if (block.type === "image") {
          const mime = typeof block.mimeType === "string" ? block.mimeType : "unknown";
          texts.push(`[image omitted: ${mime}]`);
        }
      }
      if (thinking.length > 0) parts.push(`[Assistant thinking]: ${thinking.join("\n")}`);
      if (texts.length > 0) parts.push(`[Assistant]: ${texts.join("\n")}`);
      if (toolCalls.length > 0) parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
      continue;
    }

    if (role === "toolResult") {
      const name = typeof msg.toolName === "string" ? msg.toolName : "tool";
      const text = asText(msg.content);
      const err = msg.isError ? " error" : "";
      parts.push(`[Tool result${err} ${name}]: ${text}`);
      continue;
    }

    if (role === "custom") {
      const label = msg.customType === CUSTOM_TYPE ? "Memory note" : `Custom ${msg.customType ?? ""}`;
      const text = asText(msg.content);
      if (text) parts.push(`[${label.trim()}]: ${text}`);
      continue;
    }

    if (role === "compactionSummary") {
      const summary = typeof msg.summary === "string" ? msg.summary : asText(msg.content);
      parts.push(`[Compaction summary]: ${summary}`);
      continue;
    }

    if (role === "branchSummary") {
      const summary = typeof msg.summary === "string" ? msg.summary : asText(msg.content);
      parts.push(`[Branch summary]: ${summary}`);
      continue;
    }

    if (role === "bashExecution") {
      const command = typeof msg.command === "string" ? msg.command : "";
      const output = typeof msg.output === "string" ? msg.output : asText(msg.content);
      parts.push(`[Bash]: $ ${command}\n${output}`);
      continue;
    }

    const fallback = asText(msg.content);
    if (fallback) parts.push(`[${role}]: ${fallback}`);
  }

  return parts.join("\n\n");
}

export function formatMemoryNote(body: string): string {
  const trimmed = body.trim();
  if (trimmed.startsWith(NOTE_PREFIX)) return trimmed;
  return `${NOTE_PREFIX}\n${trimmed}`;
}

export function isMemoryNoteMessage(message: SerializedMessage): boolean {
  if (message.role === "custom" && message.customType === CUSTOM_TYPE) return true;
  const text = asText(message.content);
  return text.startsWith(NOTE_PREFIX);
}

export function messageHasNoteText(message: SerializedMessage, noteBody: string): boolean {
  if (!isMemoryNoteMessage(message)) return false;
  return asText(message.content).trim() === formatMemoryNote(noteBody);
}

export function snapshotAlreadyHasNote(messages: SerializedMessage[], noteBody: string): boolean {
  return messages.some((m) => messageHasNoteText(m, noteBody));
}
