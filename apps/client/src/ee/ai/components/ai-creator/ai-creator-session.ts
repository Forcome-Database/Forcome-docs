import type { AiCreatorMessage, SelectionSnapshot } from "./ai-creator.types";
import { stripTimestamp } from "./ai-creator-utils";

export interface CreatorHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export function buildCreatorHistory(
  messages: AiCreatorMessage[],
  limit: number = 10,
): CreatorHistoryMessage[] {
  return messages
    .filter(
      (
        message,
      ): message is AiCreatorMessage & {
        role: "user" | "assistant";
      } =>
        (message.role === "user" || message.role === "assistant") &&
        message.content.trim().length > 0,
    )
    .map((message) => {
      if (message.role === "assistant") {
        return {
          role: "assistant" as const,
          content: stripTimestamp(message.content),
        };
      }

      if (message.selectionContext) {
        return {
          role: "user" as const,
          content: `[Selected text]\n${message.selectionContext.slice(0, 200)}\n\n${message.content}`,
        };
      }

      return {
        role: "user" as const,
        content: message.content,
      };
    })
    .slice(-limit);
}

export function shouldResetEditorBeforeStreaming(
  insertMode: string,
  selectionSnapshot: SelectionSnapshot | null,
): boolean {
  return insertMode === "overwrite" && !selectionSnapshot;
}
