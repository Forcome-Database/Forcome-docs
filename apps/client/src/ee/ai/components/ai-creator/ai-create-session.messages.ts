import { v7 as uuid7 } from "uuid";
import type { AgentAwaitInputData } from "../../types/agent.types";
import type {
  AiCreateAwaitInputPhase,
  AiCreateAwaitInputState,
} from "./ai-create-session.types";
import type { AiCreatorMessage } from "./ai-creator.types";
import type { SelectionRange } from "./ai-creator-atoms";

export function createInteractiveMessage(
  phase: AiCreateAwaitInputPhase,
  data: AgentAwaitInputData,
): AiCreatorMessage {
  const baseMessage = {
    id: uuid7(),
    role: phase,
    content: "",
    timestamp: Date.now(),
  } satisfies Pick<AiCreatorMessage, "id" | "role" | "content" | "timestamp">;

  // V2 phases: brief / blueprint / review — store raw data
  if (phase === "brief") {
    return {
      ...baseMessage,
      briefData:
        "brief" in data ? (data.brief as unknown as Record<string, unknown>) : undefined,
      briefAssetSummary:
        "asset_summary" in data ? data.asset_summary : undefined,
    };
  }

  if (phase === "blueprint") {
    return {
      ...baseMessage,
      blueprintData:
        "blueprint" in data ? (data.blueprint as unknown as Record<string, unknown>) : undefined,
    };
  }

  if (phase === "review") {
    return {
      ...baseMessage,
      reviewData:
        "report" in data ? (data.report as unknown as Record<string, unknown>) : undefined,
    };
  }

  return baseMessage;
}

export function createAssistantPlaceholderMessage(): AiCreatorMessage {
  return {
    id: uuid7(),
    role: "assistant",
    content: "",
    timestamp: Date.now(),
  };
}

export function createHydratedMessages({
  draftMarkdown,
  awaitInput,
}: {
  draftMarkdown: string;
  awaitInput: AiCreateAwaitInputState | null;
}): AiCreatorMessage[] {
  const messages: AiCreatorMessage[] = [];

  if (draftMarkdown.trim()) {
    messages.push({
      id: uuid7(),
      role: "assistant",
      content: draftMarkdown,
      timestamp: Date.now(),
    });
  }

  if (awaitInput) {
    messages.push(createInteractiveMessage(awaitInput.phase, awaitInput.data));
  }

  return messages;
}

interface CreatePendingRunMessagesParams {
  prompt: string;
  selection: string;
  selectionRange: SelectionRange | null;
}

export function createPendingRunMessages({
  prompt,
  selection,
  selectionRange,
}: CreatePendingRunMessagesParams): [AiCreatorMessage, AiCreatorMessage] {
  return [
    {
      id: uuid7(),
      role: "user",
      content: prompt,
      timestamp: Date.now(),
      selectionContext: selection || undefined,
      selectionRange: selectionRange || undefined,
    },
    createAssistantPlaceholderMessage(),
  ];
}
