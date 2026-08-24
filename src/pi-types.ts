/** Minimal Pi extension surface. Kept local so this package does not need Pi at test time. */

import { isReadableThinking } from "./thinking.ts";

export type PiMessage = {
  role?: string;
  customType?: string;
  content?: unknown;
  display?: boolean;
  details?: unknown;
  timestamp?: number;
  [key: string]: unknown;
};

export type PiModel = {
  id: string;
  provider: string;
  api?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
};

export type PiUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
};

export type PiContentBlock = {
  type: string;
  text?: string;
  thinking?: string;
  thinkingSignature?: string;
  redacted?: boolean;
};

export type PiAssistantMessage = {
  role: "assistant";
  content: PiContentBlock[];
  stopReason?: string;
  errorMessage?: string;
  usage?: PiUsage;
};

export type NestedCompleteOptions = {
  maxTokens?: number;
  signal?: AbortSignal;
  sessionId?: string;
  cacheRetention?: string;
  reasoning?: string;
  reasoningEffort?: string;
  apiKey?: string;
  headers?: Record<string, string>;
};

export type NestedCompleteFn = (
  model: PiModel,
  context: { systemPrompt?: string; messages: unknown[] },
  options?: NestedCompleteOptions,
) => Promise<PiAssistantMessage>;

export type ResolvedRequestAuth =
  | { ok: true; apiKey?: string; headers?: Record<string, string> }
  | { ok: false; error: string };

export interface PiModelRegistry {
  /**
   * Test / fake hook. Official Pi ModelRegistry does not have complete();
   * production nested calls go through getApiKeyAndHeaders + completeSimple.
   */
  complete?: NestedCompleteFn;
  getApiKeyAndHeaders?(model: PiModel): Promise<ResolvedRequestAuth>;
}

export interface PiSessionManager {
  getSessionId?: () => string;
  getSessionDir?: () => string;
  getSessionFile?: () => string | undefined;
  getHeader?: () => { id?: string; parentSession?: string; cwd?: string };
  getEntries?: () => Array<{ type: string; customType?: string; data?: unknown }>;
}

export interface PiExtensionContext {
  model?: PiModel;
  modelRegistry: PiModelRegistry;
  sessionManager: PiSessionManager;
  signal?: AbortSignal;
  thinkingLevel?: string;
  cwd: string;
  ui: {
    setStatus?: (key: string, text: string | undefined) => void;
    notify?: (text: string, level?: "info" | "warning" | "error") => void;
  };
}

export interface PiExtensionAPI {
  on(event: string, handler: (event: any, ctx: PiExtensionContext) => unknown): void;
  sendMessage(
    message: {
      customType: string;
      content: string;
      display: boolean;
      details?: unknown;
    },
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
  ): void;
  appendEntry(customType: string, data?: unknown): void;
  registerCommand(
    name: string,
    spec: {
      description: string;
      handler: (args: string, ctx: PiExtensionContext) => unknown;
    },
  ): void;
  /** Official Pi API. Nested memory calls use this; ctx.thinkingLevel is not set. */
  getThinkingLevel?: () => string;
}

export function extractAssistantText(message: PiAssistantMessage | undefined): string {
  if (!message?.content) return "";
  const texts = message.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string);
  const joined = texts.join("\n").trim();
  if (joined) return joined;
  // Plaintext thinking only. Encrypted/redacted reasoning is not a parseable yes/no note.
  return message.content
    .filter((b) => isReadableThinking(b))
    .map((b) => (b.thinking as string).trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function sessionIdOf(ctx: PiExtensionContext): string {
  return ctx.sessionManager.getSessionId?.() || ctx.sessionManager.getHeader?.()?.id || "in-memory";
}

export function sessionDirOf(ctx: PiExtensionContext): string | undefined {
  const fromMgr = ctx.sessionManager.getSessionDir?.();
  if (fromMgr) return fromMgr;
  const file = ctx.sessionManager.getSessionFile?.();
  if (file) return file.replace(/[/\\][^/\\]+$/, "");
  return undefined;
}
