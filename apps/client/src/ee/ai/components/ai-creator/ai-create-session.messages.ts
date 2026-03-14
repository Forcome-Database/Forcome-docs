import { v7 as uuid7 } from "uuid";
import type { AgentAwaitInputData } from "../../types/agent.types";
import type { AiCreateAwaitInputPhase } from "./ai-create-session.types";
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

  if (phase === "clarify" && data.type === "clarify") {
    return {
      ...baseMessage,
      questions: data.questions,
    };
  }

  if (phase === "propose" && data.type === "propose") {
    return {
      ...baseMessage,
      proposals: data.proposals,
    };
  }

  if (phase === "outline" && data.type === "outline") {
    return {
      ...baseMessage,
      outline: data.outline,
      artifactPlan: data.artifactPlan,
    };
  }

  // V2 phases: brief / blueprint / review — store raw data
  if (phase === "brief") {
    return {
      ...baseMessage,
      briefData: data as unknown as Record<string, unknown>,
    };
  }

  if (phase === "blueprint") {
    return {
      ...baseMessage,
      blueprintData: data as unknown as Record<string, unknown>,
    };
  }

  if (phase === "review") {
    return {
      ...baseMessage,
      reviewData: data as unknown as Record<string, unknown>,
    };
  }

  return {
    ...baseMessage,
    outline: data.type === "outline" ? data.outline : undefined,
    artifactPlan: data.type === "outline" ? data.artifactPlan : undefined,
  };
}

export function createAssistantPlaceholderMessage(): AiCreatorMessage {
  return {
    id: uuid7(),
    role: "assistant",
    content: "",
    timestamp: Date.now(),
  };
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
