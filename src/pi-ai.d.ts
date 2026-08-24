declare module "@mariozechner/pi-ai" {
  export function completeSimple(
    model: unknown,
    context: { systemPrompt?: string; messages: unknown[] },
    options?: unknown,
  ): Promise<import("./pi-types.ts").PiAssistantMessage>;
}

declare module "@earendil-works/pi-ai" {
  export function completeSimple(
    model: unknown,
    context: { systemPrompt?: string; messages: unknown[] },
    options?: unknown,
  ): Promise<import("./pi-types.ts").PiAssistantMessage>;
}
